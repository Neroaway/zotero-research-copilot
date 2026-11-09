export type Language = "en" | "zh";
export type LanguageSetting = "auto" | Language;

export const DEFAULT_MODEL = "gpt-5-mini";
const PREFIX = "extensions.zotero.researchCopilot.";
const CIPHERTEXT = PREFIX + "encryptedOpenAIKey";

export interface Preferences {
  get(name: string, global: true): unknown;
  set(name: string, value: string, global: true): void;
  clear(name: string, global: true): void;
}

export interface KeyStore {
  readonly available: boolean;
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
  isEncrypted(value: unknown): boolean;
}

export type KeyStatus = "missing" | "session" | "encrypted" | "locked";

export class Settings {
  private readonly prefs: Preferences;
  private readonly keyStore?: KeyStore;
  private sessionKey?: string;
  private disposed = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(prefs: Preferences, keyStore?: KeyStore) {
    this.prefs = prefs;
    this.keyStore = keyStore;
  }

  get model(): string {
    const model = this.prefs.get(PREFIX + "model", true);
    return typeof model === "string" && validModel(model) ? model : DEFAULT_MODEL;
  }

  get language(): LanguageSetting {
    const value = this.prefs.get(PREFIX + "language", true);
    return value === "en" || value === "zh" ? value : "auto";
  }

  setOptions(model: string, language: LanguageSetting): void {
    if (!validModel(model)) throw new Error("Invalid model ID");
    this.prefs.set(PREFIX + "model", model, true);
    this.prefs.set(PREFIX + "language", language, true);
  }

  status(): KeyStatus {
    if (this.sessionKey) return "session";
    const value = this.prefs.get(CIPHERTEXT, true);
    if (typeof value !== "string" || !value) return "missing";
    return this.keyStore?.isEncrypted(value) ? "encrypted" : "locked";
  }

  async getKey(): Promise<string | undefined> {
    await this.pending;
    if (this.disposed) return undefined;
    if (this.sessionKey) return this.sessionKey;
    const value = this.prefs.get(CIPHERTEXT, true);
    if (typeof value !== "string" || !value) return undefined;
    if (!this.keyStore?.isEncrypted(value)) throw new Error("Key unavailable");
    const decrypted = await this.keyStore.decrypt(value);
    if (!validKey(decrypted)) throw new Error("Key unavailable");
    return decrypted;
  }

  saveKey(value: string, remember: boolean): Promise<KeyStatus> {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error("Settings unavailable");
      if (!validKey(value)) throw new Error("Invalid key");
      if (remember) {
        let encrypted: string | undefined;
        try {
          if (this.keyStore?.available) {
            const result = await this.keyStore.encrypt(value);
            if (this.keyStore.isEncrypted(result) && result !== value) encrypted = result;
          }
        } catch {
          // Losing access to the OS store leaves the session-only route available.
        }
        if (this.disposed) throw new Error("Settings unavailable");
        if (encrypted) {
          this.prefs.set(CIPHERTEXT, encrypted, true);
          this.sessionKey = undefined;
          return "encrypted";
        }
      }
      this.prefs.clear(CIPHERTEXT, true);
      this.sessionKey = value;
      return "session";
    });
  }

  clearKey(): Promise<void> {
    return this.enqueue(() => {
      this.prefs.clear(CIPHERTEXT, true);
      this.sessionKey = undefined;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.sessionKey = undefined;
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
}

export function validModel(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model);
}

export function validKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{12,512}$/.test(key);
}

export function resolveLanguage(setting: LanguageSetting, locale: string): Language {
  return setting === "auto" ? (locale.toLowerCase().startsWith("zh") ? "zh" : "en") : setting;
}
