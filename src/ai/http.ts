import { CopilotError } from "../errors.ts";
import type { ErrorCode } from "../errors.ts";
import type { AIResult, Usage } from "./provider.ts";
import { eventData } from "./sse.ts";

export const MAX_RESPONSE_CHARS = 100_000;

export function apiError(status?: number, code?: string): ErrorCode {
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached" || status === 402) return "quota";
  if (code === "rate_limit_exceeded" || code === "rate_limit_error" || status === 429) return "rate-limit";
  if (code === "invalid_api_key" || code === "authentication_error" || status === 401) return "auth";
  if (code === "permission_error" || status === 403) return "permission";
  if (code === "model_not_found" || code === "not_found_error" || status === 404) return "model-unavailable";
  if (code === "overloaded_error" || code === "api_error" || (status && status >= 500)) return "server";
  return status ? "bad-request" : "stream";
}

export async function apiRequest(
  send: typeof fetch,
  url: string,
  signal: AbortSignal,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  let response: Response;
  try {
    signal.throwIfAborted();
    response = await send(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { ...headers, Accept: "application/json" }
        : { ...headers, "Content-Type": "application/json", Accept: "text/event-stream" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch {
    signal.throwIfAborted();
    throw new CopilotError("network");
  }
  signal.throwIfAborted();
  if (!response.ok) {
    const payload = response.status === 429
      ? await response.json().catch(() => null) as { error?: { code?: string } } | null
      : undefined;
    signal.throwIfAborted();
    throw new CopilotError(apiError(response.status, payload?.error?.code), response.status);
  }
  return response;
}

export async function modelCatalog(response: Response, signal: AbortSignal): Promise<string[]> {
  const catalog = await response.json().catch(() => null) as { data?: { id?: unknown }[] } | null;
  signal.throwIfAborted();
  if (!Array.isArray(catalog?.data)) throw new CopilotError("model-list");
  return catalog.data.flatMap((entry) => typeof entry?.id === "string" ? [entry.id] : []);
}

export async function* apiEvents(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new CopilotError("stream");
  }
  try {
    for await (const data of eventData(response.body)) {
      signal.throwIfAborted();
      if (data) yield data;
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof CopilotError) throw error;
    throw new CopilotError("stream");
  }
  signal.throwIfAborted();
}

export function parseEvent<T>(data: string): T {
  try {
    const event: unknown = JSON.parse(data);
    if (event && typeof event === "object" && !Array.isArray(event)) return event as T;
  } catch {
    // Convert malformed remote data to a local error without echoing it.
  }
  throw new CopilotError("stream");
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function readUsage(input: unknown, output: unknown, cached?: unknown, reasoning?: unknown): Usage | undefined {
  if (!tokenCount(input) || !tokenCount(output)) return;
  return {
    inputTokens: input, outputTokens: output,
    cachedTokens: tokenCount(cached) && cached <= input ? cached : undefined,
    ...(tokenCount(reasoning) && reasoning <= output ? { reasoningTokens: reasoning } : {}),
  };
}

export function appendDelta(text: string, delta: string, onDelta: (delta: string) => void): string {
  if (text.length + delta.length > MAX_RESPONSE_CHARS) throw new CopilotError("stream");
  onDelta(delta);
  return text + delta;
}

export function completeText(text: string, usage?: Usage): AIResult {
  if (!text.trim()) throw new CopilotError("empty-response");
  if (text.length > MAX_RESPONSE_CHARS) throw new CopilotError("stream");
  return { text, usage };
}
