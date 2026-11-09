import type { ReasoningEffort } from "./reasoning.ts";

export const ANALYSIS_BUDGETS = ["auto", "16000", "32000", "64000", "api"] as const;
export type AnalysisBudget = typeof ANALYSIS_BUDGETS[number];

// Responses counts reasoning and visible text against the same limit.
const AUTO_LIMITS: Record<ReasoningEffort, number> = {
  none: 7_000,
  low: 7_000,
  medium: 12_000,
  high: 16_000,
  xhigh: 25_000,
  max: 32_000,
};

export function analysisBudgetSetting(value: unknown): AnalysisBudget {
  return ANALYSIS_BUDGETS.find((budget) => budget === value) ?? "auto";
}

export function analysisOutputTokens(budget: AnalysisBudget, effort?: ReasoningEffort): number | undefined {
  if (budget === "api") return undefined;
  return budget === "auto" ? AUTO_LIMITS[effort ?? "medium"] : Number(budget);
}
