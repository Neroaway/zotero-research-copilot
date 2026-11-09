import { CopilotError } from "../errors.ts";
import { apiError, apiEvents, apiRequest, appendDelta, completeText, modelCatalog, parseEvent, readUsage } from "./http.ts";
import type { AIRequest, AIResult, ModelProvider, Usage } from "./provider.ts";
import type { ProviderConnection } from "./providers.ts";

interface WireChunk {
  choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string }[];
  error?: { code?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function bodyFor(request: AIRequest, mimo: boolean) {
  const content = request.imageURL
    ? [{ type: "text", text: request.text }, { type: "image_url", image_url: { url: request.imageURL } }]
    : request.text;
  const budgetField = mimo ? "max_completion_tokens" : "max_tokens";
  return {
    model: request.model,
    messages: [{ role: "system", content: request.instructions }, { role: "user", content }],
    stream: true,
    ...(request.maxOutputTokens === undefined ? {} : { [budgetField]: request.maxOutputTokens }),
    ...(mimo && request.reasoningEffort === "none" ? { thinking: { type: "disabled" } } : {}),
  };
}

export class ChatCompletionsProvider implements ModelProvider {
  private readonly send: typeof fetch;
  private readonly connection: ProviderConnection;

  constructor(send: typeof fetch, connection: ProviderConnection) {
    this.send = send;
    this.connection = connection;
  }

  async listModels(key: string, signal: AbortSignal): Promise<string[]> {
    const response = await apiRequest(this.send, `${this.connection.baseURL}/models`, signal, { Authorization: `Bearer ${key}` });
    return modelCatalog(response, signal);
  }

  async generate(
    request: AIRequest,
    key: string,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    onUsage: (usage: Usage) => void,
  ): Promise<AIResult> {
    const response = await apiRequest(this.send, `${this.connection.baseURL}/chat/completions`, signal,
      { Authorization: `Bearer ${key}` }, bodyFor(request, this.connection.id === "mimo"));
    let text = "";
    let usage: Usage | undefined;
    let finishReason: string | undefined;
    let refused = false;
    for await (const data of apiEvents(response, signal)) {
      if (data === "[DONE]") break;
      const event = parseEvent<WireChunk>(data);
      if (event.error) throw new CopilotError(apiError(undefined, event.error.code));
      const counts = event.usage;
      const parsed = readUsage(counts?.prompt_tokens, counts?.completion_tokens,
        counts?.prompt_tokens_details?.cached_tokens, counts?.completion_tokens_details?.reasoning_tokens);
      if (parsed) {
        usage = parsed;
        onUsage(usage);
      }
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === "string") text = appendDelta(text, choice.delta.content, onDelta);
      if (choice?.delta?.refusal) refused = true;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    if (!finishReason) throw new CopilotError("stream");
    if (finishReason === "length") throw new CopilotError("output-limit");
    if (refused || finishReason === "content_filter") throw new CopilotError("refusal");
    if (finishReason !== "stop") throw new CopilotError("incomplete");
    return completeText(text, usage);
  }
}
