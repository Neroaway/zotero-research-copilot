import { CopilotError } from "../errors.ts";
import type { AIProvider, Usage } from "./provider.ts";

export async function testOpenAIConnection(
  provider: AIProvider,
  model: string,
  key: string,
  controller: AbortController,
): Promise<Usage | undefined> {
  const timeout = setTimeout(() => controller.abort(new CopilotError("timeout")), 30_000);
  const ignore = () => {};
  try {
    const result = await provider.generate({
      model,
      instructions: "Reply with only OK.",
      text: "Zotero Research Copilot API connection test.",
      maxOutputTokens: 256,
    }, key, controller.signal, ignore, ignore);
    controller.signal.throwIfAborted();
    return result.usage;
  } finally {
    clearTimeout(timeout);
  }
}
