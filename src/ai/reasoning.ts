import type { ProviderID } from "./providers.ts";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

const UP_TO_XHIGH = ["none", "low", "medium", "high", "xhigh"] as const;
const UP_TO_MAX = [...UP_TO_XHIGH, "max"] as const;
const WITHOUT_NONE = ["low", "medium", "high", "xhigh", "max"] as const;

const DEEPSEEK = ["none", "low", "high", "max"] as const;

// Only send levels documented for this provider and model ID.
const LEVELS: Record<ProviderID, Readonly<Record<string, readonly ReasoningEffort[]>>> = {
  openai: {
    "gpt-5.4-nano": UP_TO_XHIGH,
    "gpt-5.4-mini": UP_TO_XHIGH,
    "gpt-5.4": UP_TO_XHIGH,
    "gpt-5.6-terra": UP_TO_MAX,
    "gpt-6-luna": UP_TO_MAX,
    "gpt-6.1-terra": UP_TO_MAX,
    "gpt-6.1-sol": WITHOUT_NONE,
    "gpt-6-astra": WITHOUT_NONE,
  },
  deepseek: {
    "deepseek-flash": DEEPSEEK,
    "deepseek-v4-pro": DEEPSEEK,
  },
  claude: {
    "claude-sonnet-5-5": WITHOUT_NONE,
    "claude-opus-5-5": WITHOUT_NONE,
    "claude-haiku-5-5": WITHOUT_NONE,
  },
  mimo: {
    "mimo-v2.6-flash": ["none"],
    "mimo-v2.6-pro": ["none"],
    "mimo-v2.6-pro-ultraspeed": ["none"],
  },
  grok: {
    "grok-4.7": ["low", "medium", "high", "xhigh"],
    "grok-4.3": ["none", "low"],
  },
  compatible: {},
};

export function reasoningOptions(model: string, provider: ProviderID = "openai"): readonly ReasoningEffort[] {
  const levels = LEVELS[provider];
  return Object.hasOwn(levels, model) ? levels[model] ?? [] : [];
}

export function supportedReasoning(model: string, value: unknown, provider?: ProviderID): ReasoningEffort | undefined {
  return reasoningOptions(model, provider).find((level) => level === value);
}
