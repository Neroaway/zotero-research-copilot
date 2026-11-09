export const PROVIDERS = {
  openai: {
    name: "OpenAI", baseURL: "https://api.openai.com/v1",
    models: ["gpt-5-mini", "gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.4", "gpt-5.6-terra",
      "gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
  },
  deepseek: {
    name: "DeepSeek", baseURL: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  claude: {
    name: "Claude (Anthropic)", baseURL: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
  mimo: {
    name: "Xiaomi MiMo", baseURL: "https://api.xiaomimimo.com/v1",
    models: ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed"],
  },
  grok: {
    name: "Grok (xAI)", baseURL: "https://api.x.ai/v1",
    models: ["grok-4.7", "grok-4.3"],
  },
  compatible: {
    name: "OpenAI-compatible", baseURL: "", models: [],
  },
} as const;

export type ProviderID = keyof typeof PROVIDERS;

export interface ProviderConnection {
  readonly id: ProviderID;
  readonly baseURL: string;
}

export function providerID(value: unknown): ProviderID {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value) ? value as ProviderID : "openai";
}

export function providerConnection(id: ProviderID, baseURL = ""): ProviderConnection | undefined {
  if (id !== "compatible") return { id, baseURL: PROVIDERS[id].baseURL };
  const value = baseURL.trim();
  if (value.length > 512 || !/^https?:\/\//iu.test(value) || /[\s\\@?#]/u.test(value)) return;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return;
    const normalized = url.href.replace(/\/+$/u, "");
    if (/\/(chat\/completions|models)$/u.test(url.pathname.replace(/\/+$/u, ""))) return;
    return { id, baseURL: normalized };
  } catch {
    // A full URL is required before a custom endpoint can receive credentials.
  }
}
