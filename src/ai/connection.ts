import { CopilotError } from "../errors.ts";
import type { AIProvider, Usage } from "./provider.ts";

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

export function testOpenAIConnection(
  provider: AIProvider,
  model: string,
  key: string,
  controller: AbortController,
): Promise<Usage | undefined> {
  const ignore = () => {};
  return withApiTimeout(controller, async (signal) => {
    const result = await provider.generate({
      model,
      instructions: "Reply with only OK.",
      text: "Zotero Research Copilot API connection test.",
      maxOutputTokens: 256,
    }, key, signal, ignore, ignore);
    return result.usage;
  });
}
