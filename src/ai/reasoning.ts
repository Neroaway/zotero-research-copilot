export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

const UP_TO_XHIGH = ["none", "low", "medium", "high", "xhigh"] as const;
const UP_TO_MAX = [...UP_TO_XHIGH, "max"] as const;
const WITHOUT_NONE = ["low", "medium", "high", "xhigh", "max"] as const;

// Model-specific levels from the OpenAI API model cards. Unknown IDs use API defaults.
const LEVELS: Readonly<Record<string, readonly ReasoningEffort[]>> = {
  "gpt-5.4-nano": UP_TO_XHIGH,
  "gpt-5.4-mini": UP_TO_XHIGH,
  "gpt-5.4": UP_TO_XHIGH,
  "gpt-5.6-terra": UP_TO_MAX,
  "gpt-6-luna": UP_TO_MAX,
  "gpt-6.1-terra": UP_TO_MAX,
  "gpt-6.1-sol": WITHOUT_NONE,
  "gpt-6-astra": WITHOUT_NONE,
};

export function reasoningOptions(model: string): readonly ReasoningEffort[] {
  return Object.hasOwn(LEVELS, model) ? LEVELS[model] ?? [] : [];
}

export function supportedReasoning(model: string, value: unknown): ReasoningEffort | undefined {
  return reasoningOptions(model).find((level) => level === value);
}
