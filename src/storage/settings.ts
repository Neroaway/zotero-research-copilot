import { analysisBudgetSetting } from "../ai/output-budget.ts";
import { PROVIDERS, providerConnection, providerID } from "../ai/providers.ts";
import type { ProviderConnection, ProviderID } from "../ai/providers.ts";
import { supportedReasoning } from "../ai/reasoning.ts";
import { responseTimeoutSetting } from "../research/timeouts.ts";

export type Language = "en" | "zh";
export type LanguageSetting = "auto" | Language;

const PREFIX = "extensions.zotero.researchCopilot.";

function prefName(connection: ProviderConnection, name: string, legacyName = name): string {
  if (connection.id === "openai") return PREFIX + legacyName;
  const scope = connection.id === "compatible" ? `compatible.${encodeURIComponent(connection.baseURL)}` : connection.id;
  return `${PREFIX}${scope}.${name}`;
}

function keyPref(connection: ProviderConnection): string {
  return prefName(connection, "encryptedKey", "encryptedOpenAIKey");
}

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
  private readonly modelListeners = new Set<(model: string, provider: ProviderID) => void>();
  private readonly sessionKeys = new Map<string, string>();
  private disposed = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(prefs: Preferences, keyStore?: KeyStore) {
    this.prefs = prefs;
    this.keyStore = keyStore;
  }

  get providerID(): ProviderID {
    return providerID(this.prefs.get(PREFIX + "provider", true));
  }

  get compatibleBaseURL(): string {
    const value = this.prefs.get(PREFIX + "compatibleBaseURL", true);
    return typeof value === "string" ? value : "";
  }

  get connection(): ProviderConnection | undefined {
    return providerConnection(this.providerID, this.compatibleBaseURL);
  }

  get model(): string {
    const connection = this.connection;
    return connection ? this.modelFor(connection) : "";
  }

  modelFor(connection: ProviderConnection): string {
    const model = this.prefs.get(prefName(connection, "model"), true);
    return typeof model === "string" && validModel(model) ? model : PROVIDERS[connection.id].models[0] ?? "";
  }

  get language(): LanguageSetting {
    const value = this.prefs.get(PREFIX + "language", true);
    return value === "en" || value === "zh" ? value : "auto";
  }

  get reasoningEffort() {
    const connection = this.connection;
    return connection && this.reasoningFor(connection);
  }

  reasoningFor(connection: ProviderConnection) {
    return supportedReasoning(this.modelFor(connection), this.prefs.get(prefName(connection, "reasoningEffort"), true), connection.id);
  }

  analysisBudgetFor(connection: ProviderConnection) {
    const value = analysisBudgetSetting(this.prefs.get(prefName(connection, "analysisBudget"), true));
    return connection.id === "claude" && value === "api" ? "auto" : value;
  }

  responseTimeoutFor(connection: ProviderConnection) {
    return responseTimeoutSetting(this.prefs.get(prefName(connection, "responseTimeout"), true));
  }

  setResponseTimeout(value: string, connection = this.connection): void {
    if (connection) this.prefs.set(prefName(connection, "responseTimeout"), responseTimeoutSetting(value), true);
  }

  get obsidianPath(): string {
    const value = this.prefs.get(PREFIX + "obsidianPath", true);
    return typeof value === "string" ? value : "";
  }

  setObsidianPath(path: string): void {
    if (path) this.prefs.set(PREFIX + "obsidianPath", path, true);
    else this.prefs.clear(PREFIX + "obsidianPath", true);
  }

  setOptions(model: string, language: LanguageSetting, reasoning = "", analysisBudget?: string, connection = this.connection): void {
    if (!connection) throw new Error("Invalid API URL");
    if (!validModel(model)) throw new Error("Invalid model ID");
    const changed = this.model !== model || this.providerID !== connection.id || this.connection?.baseURL !== connection.baseURL;
    this.prefs.set(prefName(connection, "model"), model, true);
    this.prefs.set(PREFIX + "language", language, true);
    const effort = supportedReasoning(model, reasoning, connection.id);
    const effortPref = prefName(connection, "reasoningEffort");
    if (effort) this.prefs.set(effortPref, effort, true);
    else this.prefs.clear(effortPref, true);
    if (analysisBudget !== undefined) {
      this.prefs.set(prefName(connection, "analysisBudget"), analysisBudgetSetting(analysisBudget), true);
    }
    if (connection.id === "compatible") this.prefs.set(PREFIX + "compatibleBaseURL", connection.baseURL, true);
    this.prefs.set(PREFIX + "provider", connection.id, true);
    if (changed) this.modelListeners.forEach((listener) => listener(model, connection.id));
  }

  watchModel(listener: (model: string, provider: ProviderID) => void): () => void {
    listener(this.model, this.providerID);
    this.modelListeners.add(listener);
    return () => { this.modelListeners.delete(listener); };
  }

  status(connection = this.connection): KeyStatus {
    if (!connection) return "missing";
    const pref = keyPref(connection);
    if (this.sessionKeys.has(pref)) return "session";
    const value = this.prefs.get(pref, true);
    if (typeof value !== "string" || !value) return "missing";
    return this.keyStore?.isEncrypted(value) ? "encrypted" : "locked";
  }

  async getKey(connection = this.connection): Promise<string | undefined> {
    if (!connection) return;
    const pref = keyPref(connection);
    await this.pending;
    if (this.disposed) return undefined;
    const sessionKey = this.sessionKeys.get(pref);
    if (sessionKey) return sessionKey;
    const value = this.prefs.get(pref, true);
    if (typeof value !== "string" || !value) return undefined;
    if (!this.keyStore?.isEncrypted(value)) throw new Error("Key unavailable");
    const decrypted = await this.keyStore.decrypt(value);
    if (this.disposed) return undefined;
    if (!validKey(decrypted)) throw new Error("Key unavailable");
    return decrypted;
  }

  saveKey(value: string, remember: boolean, connection = this.connection): Promise<KeyStatus> {
    return this.enqueue(async () => {
      if (!connection) throw new Error("Invalid API URL");
      const pref = keyPref(connection);
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
          this.prefs.set(pref, encrypted, true);
          this.sessionKeys.delete(pref);
          return "encrypted";
        }
      }
      this.prefs.clear(pref, true);
      this.sessionKeys.set(pref, value);
      return "session";
    });
  }

  clearKey(connection = this.connection): Promise<void> {
    return this.enqueue(() => {
      if (!connection) return;
      const pref = keyPref(connection);
      this.prefs.clear(pref, true);
      this.sessionKeys.delete(pref);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.sessionKeys.clear();
    this.modelListeners.clear();
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }
}

export function validModel(model: string): boolean {
  return /^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]{0,127}$/u.test(model);
}

export function validKey(key: string): boolean {
  return key.length <= 512 && /^[a-zA-Z0-9._~+/-]+=*$/u.test(key);
}

export function resolveLanguage(setting: LanguageSetting, locale: string): Language {
  return setting === "auto" ? (locale.toLowerCase().startsWith("zh") ? "zh" : "en") : setting;
}
