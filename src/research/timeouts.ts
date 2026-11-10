import type { ReasoningEffort } from "../ai/reasoning.ts";
import type { TaskMode } from "./prompts.ts";

export const RESPONSE_TIMEOUTS = ["none", "auto", "4", "10", "20", "30", "60"] as const;
export type ResponseTimeout = typeof RESPONSE_TIMEOUTS[number];

export function responseTimeoutSetting(value: unknown): ResponseTimeout {
  return RESPONSE_TIMEOUTS.find((option) => option === value) ?? "none";
}

export function requestTimeoutMs(mode: TaskMode, effort?: ReasoningEffort, timeout: ResponseTimeout = "none"): number | undefined {
  if (timeout === "none") return undefined;
  const minutes = timeout === "auto" ? mode !== "analysis" ? 4 : effort === "max" || effort === "xhigh" ? 30 : 10 : Number(timeout);
  return minutes * 60_000;
}
