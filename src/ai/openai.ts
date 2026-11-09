import { CopilotError } from "../errors.ts";
import type { ErrorCode } from "../errors.ts";
import { eventData } from "./sse.ts";
import type { AIProvider, AIRequest, AIResult, Usage } from "./provider.ts";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_RESPONSE_CHARS = 100_000;

type Fetch = typeof fetch;
interface WireUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

interface WireResponse {
  usage?: WireUsage;
  error?: { code?: string };
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
  const input = response?.usage?.input_tokens;
  const output = response?.usage?.output_tokens;
  if (typeof input !== "number" || typeof output !== "number" || !Number.isFinite(input) || !Number.isFinite(output)
    || input < 0 || output < 0) return undefined;
  const cached = response?.usage?.input_tokens_details?.cached_tokens;
  return { inputTokens: input, outputTokens: output, cachedTokens: cached };
}

function codeForStatus(status?: number, code?: string): ErrorCode {
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") return "quota";
  if (code === "rate_limit_exceeded" || status === 429) return "rate-limit";
  if (code === "invalid_api_key" || status === 401) return "auth";
  if (status === 403) return "permission";
  if (code === "model_not_found" || status === 404) return "model-unavailable";
  if (status && status >= 500) return "server";
  return status ? "bad-request" : "stream";
}

function bodyFor(request: AIRequest) {
  return {
    model: request.model,
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
    max_output_tokens: request.maxOutputTokens,
  };
}

export class OpenAIProvider implements AIProvider {
  private readonly send: Fetch;

  constructor(send: Fetch) {
    this.send = send;
  }

  async generate(
    request: AIRequest,
    key: string,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    onUsage: (usage: Usage) => void,
  ): Promise<AIResult> {
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await this.send(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        body: JSON.stringify(bodyFor(request)),
        signal,
      });
    } catch {
      signal.throwIfAborted();
      throw new CopilotError("network");
    }
    if (!response.ok) {
      const result = response.status === 429
        ? await response.json().catch(() => null) as { error?: { code?: string } } | null
        : undefined;
      signal.throwIfAborted();
      throw new CopilotError(codeForStatus(response.status, result?.error?.code), response.status);
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new CopilotError("stream");
    }

    let text = "";
    let refusal = false;
    try {
      for await (const data of eventData(response.body)) {
        signal.throwIfAborted();
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as WireEvent;
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
          if (text.length > MAX_RESPONSE_CHARS) throw new CopilotError("stream");
          onDelta(event.delta);
          continue;
        }
        if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") refusal = true;
        if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "response.completed") {
          const usage = usageFrom(event.response);
          if (usage) onUsage(usage);
          if (event.type === "response.failed") throw new CopilotError(codeForStatus(undefined, event.response?.error?.code));
          if (event.type === "response.incomplete") throw new CopilotError("incomplete");
          const content = event.response?.output?.flatMap((item) => item.type === "message" ? item.content ?? [] : []) ?? [];
          if (refusal || content.some((part) => part.type === "refusal")) throw new CopilotError("refusal");
          const finalText = content.filter((part) => part.type === "output_text" && typeof part.text === "string")
            .map((part) => part.text).join("\n") || text;
          if (!finalText.trim()) throw new CopilotError("empty-response");
          if (finalText.length > MAX_RESPONSE_CHARS) throw new CopilotError("stream");
          return { text: finalText, usage };
        }
        if (event.type === "error") throw new CopilotError(codeForStatus(undefined, event.code));
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof CopilotError) throw error;
      throw new CopilotError("stream");
    }
    signal.throwIfAborted();
    throw new CopilotError("stream");
  }
}
