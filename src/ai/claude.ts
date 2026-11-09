import { CopilotError } from "../errors.ts";
import { apiError, apiEvents, apiRequest, appendDelta, completeText, modelCatalog, parseEvent, readUsage } from "./http.ts";
import type { AIRequest, AIResult, ModelProvider, Usage } from "./provider.ts";
import { PROVIDERS } from "./providers.ts";

interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface WireEvent {
  type?: string;
  message?: { usage?: WireUsage; stop_reason?: string };
  content_block?: { type?: string; text?: string };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: WireUsage;
  error?: { type?: string };
}

function bodyFor(request: AIRequest) {
  const content: unknown[] = [{ type: "text", text: request.text }];
  if (request.imageURL) {
    const image = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-zA-Z0-9+/=]+)$/u.exec(request.imageURL);
    if (!image) throw new CopilotError("image-format");
    content.push({ type: "image", source: { type: "base64", media_type: image[1], data: image[2] } });
  }
  return {
    model: request.model,
    system: request.instructions,
    messages: [{ role: "user", content }],
    stream: true,
    max_tokens: request.maxOutputTokens ?? 12_000,
    ...(request.reasoningEffort && { output_config: { effort: request.reasoningEffort } }),
  };
}

function headers(key: string) {
  return { "x-api-key": key, "anthropic-version": "2023-06-01" };
}

function totalUsage(usage: WireUsage): Usage | undefined {
  if (typeof usage.input_tokens !== "number") return;
  const input = usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return readUsage(input, usage.output_tokens, usage.cache_read_input_tokens);
}

export class ClaudeProvider implements ModelProvider {
  private readonly send: typeof fetch;

  constructor(send: typeof fetch) {
    this.send = send;
  }

  async listModels(key: string, signal: AbortSignal): Promise<string[]> {
    const response = await apiRequest(this.send, `${PROVIDERS.claude.baseURL}/models?limit=1000`, signal, headers(key));
    return modelCatalog(response, signal);
  }

  async generate(
    request: AIRequest,
    key: string,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    onUsage: (usage: Usage) => void,
  ): Promise<AIResult> {
    const response = await apiRequest(this.send, `${PROVIDERS.claude.baseURL}/messages`, signal, headers(key), bodyFor(request));
    let text = "";
    let usage: WireUsage = {};
    let stopReason: string | undefined;
    for await (const data of apiEvents(response, signal)) {
      const event = parseEvent<WireEvent>(data);
      if (event.type === "message_start") {
        usage = event.message?.usage ?? {};
        stopReason = event.message?.stop_reason;
      }
      if (event.type === "message_delta") {
        // Anthropic reports cumulative usage. Fields omitted in deltas retain their initial values.
        usage = { ...usage, ...event.usage };
        stopReason = event.delta?.stop_reason ?? stopReason;
      }
      const part = event.type === "content_block_delta" && event.delta?.type === "text_delta" ? event.delta
        : event.type === "content_block_start" && event.content_block?.type === "text" ? event.content_block : undefined;
      if (typeof part?.text === "string") text = appendDelta(text, part.text, onDelta);
      if (event.type === "error") {
        const counts = totalUsage(usage);
        if (counts) onUsage(counts);
        throw new CopilotError(apiError(undefined, event.error?.type));
      }
      if (event.type === "message_stop") {
        const counts = totalUsage(usage);
        if (counts) onUsage(counts);
        if (stopReason === "max_tokens") throw new CopilotError("output-limit");
        if (stopReason === "refusal") throw new CopilotError("refusal");
        if (stopReason !== "end_turn" && stopReason !== "stop_sequence") throw new CopilotError("incomplete");
        return completeText(text, counts);
      }
    }
    throw new CopilotError("stream");
  }
}
