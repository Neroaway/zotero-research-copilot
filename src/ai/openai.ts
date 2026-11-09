import { CopilotError } from "../errors.ts";
import { apiError, apiEvents, apiRequest, appendDelta, completeText, modelCatalog, parseEvent, readUsage } from "./http.ts";
import type { AIRequest, AIResult, ModelProvider, Usage } from "./provider.ts";
import { PROVIDERS } from "./providers.ts";
import type { ProviderConnection } from "./providers.ts";

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface WireResponse {
  usage?: WireUsage;
  error?: { code?: string };
  incomplete_details?: { reason?: string } | null;
  status?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
}

interface WireEvent {
  type?: string;
  delta?: string;
  code?: string;
  response?: WireResponse;
}

function usageFrom(response?: WireResponse): Usage | undefined {
  const usage = response?.usage;
  return readUsage(usage?.input_tokens, usage?.output_tokens,
    usage?.input_tokens_details?.cached_tokens, usage?.output_tokens_details?.reasoning_tokens);
}

function bodyFor(request: AIRequest) {
  return {
    model: request.model,
    ...(request.reasoningEffort && { reasoning: { effort: request.reasoningEffort } }),
    instructions: request.instructions,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: request.text },
        ...(request.imageURL ? [{ type: "input_image", image_url: request.imageURL, detail: "high" }] : []),
      ],
    }],
    stream: true,
    store: false,
    ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
  };
}

/** Responses protocol shared by OpenAI, DeepSeek and Grok. */
export class OpenAIProvider implements ModelProvider {
  private readonly send: typeof fetch;
  private readonly connection: ProviderConnection;

  constructor(
    send: typeof fetch,
    connection: ProviderConnection = { id: "openai", baseURL: PROVIDERS.openai.baseURL },
  ) {
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
    if (this.connection.id === "deepseek" && request.model === "deepseek-v4-pro" && request.imageURL) {
      throw new CopilotError("image-model");
    }
    const response = await apiRequest(this.send, `${this.connection.baseURL}/responses`, signal,
      { Authorization: `Bearer ${key}` }, bodyFor(request));

    let text = "";
    let refusal = false;
    for await (const data of apiEvents(response, signal)) {
      if (data === "[DONE]") continue;
      const event = parseEvent<WireEvent>(data);
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text = appendDelta(text, event.delta, onDelta);
      }
      if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") refusal = true;
      if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "response.completed") {
        const usage = usageFrom(event.response);
        if (usage) onUsage(usage);
        if (event.type === "response.failed") throw new CopilotError(apiError(undefined, event.response?.error?.code));
        if (event.type === "response.incomplete") {
          const reason = event.response?.incomplete_details?.reason;
          throw new CopilotError(reason === "max_output_tokens" ? "output-limit" : "incomplete");
        }
        const content = Array.isArray(event.response?.output)
          ? event.response.output.flatMap((item) => item?.type === "message" && Array.isArray(item.content) ? item.content : [])
          : [];
        if (refusal || content.some((part) => part?.type === "refusal")) throw new CopilotError("refusal");
        const finalText = content.filter((part) => part?.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text).join("\n") || text;
        return completeText(finalText, usage);
      }
      if (event.type === "error") throw new CopilotError(apiError(undefined, event.code));
    }
    throw new CopilotError("stream");
  }
}
