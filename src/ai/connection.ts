import { CopilotError } from "../errors.ts";
import type { AIProvider, AIRequest, Usage } from "./provider.ts";
import type { ProviderID } from "./providers.ts";
import { reasoningOptions } from "./reasoning.ts";

export async function withApiTimeout<T>(
  controller: AbortController,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = setTimeout(() => controller.abort(new CopilotError("timeout")), 30_000);
  try {
    controller.signal.throwIfAborted();
    const result = await request(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export function shortResponseOptions(model: string, provider: ProviderID): Pick<AIRequest, "reasoningEffort" | "maxOutputTokens"> {
  const reasoningEffort = provider === "openai" ? undefined : reasoningOptions(model, provider)[0];
  return { reasoningEffort, maxOutputTokens: reasoningEffort === "low" ? 1024 : 256 };
}

export function testConnection(
  provider: AIProvider,
  model: string,
  key: string,
  controller: AbortController,
  providerID: ProviderID = "openai",
): Promise<Usage | undefined> {
  const ignore = () => {};
  return withApiTimeout(controller, async (signal) => {
    const result = await provider.generate({
      model,
      instructions: "Reply with only OK.",
      text: "Zotero Research Copilot API connection test.",
      ...shortResponseOptions(model, providerID),
    }, key, signal, ignore, ignore);
    return result.usage;
  });
}
