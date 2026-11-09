import assert from "node:assert/strict";
import { test } from "node:test";
import { testOpenAIConnection } from "../src/ai/connection.ts";
import { CopilotError } from "../src/errors.ts";
import { OpenAIProvider } from "../src/ai/openai.ts";
import type { AIRequest, Usage } from "../src/ai/provider.ts";

const request: AIRequest = {
  model: "gpt-5-mini", instructions: "Fixture instructions", text: "Fixture",
  maxOutputTokens: 2_600, imageURL: "data:image/jpeg;base64,AA==",
};
const encoder = new TextEncoder();
const complete = { type: "response.completed", response: { usage: { input_tokens: 11, output_tokens: 7, input_tokens_details: { cached_tokens: 3 } } } };
const wire = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
const response = (body: string | ReadableStream<Uint8Array>, status = 200) => new Response(body, {
  status, headers: { "content-type": "text/event-stream" },
});
const noop = () => {};

test("Responses request stays scoped, handles byte-split UTF-8/CRLF, and records real token counts", async () => {
  const encoded = encoder.encode(
    wire({ type: "response.output_text.delta", delta: "凝视" })
      + wire({ type: "response.output_text.delta", delta: "模型" })
      + wire(complete),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const provider = new OpenAIProvider(async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer fixture-key-in-memory");
    const json = JSON.parse(String(options?.body));
    assert.equal(json.model, request.model);
    assert.equal(json.stream, true);
    assert.equal(json.store, false);
    assert.equal(json.max_output_tokens, request.maxOutputTokens);
    assert.equal(json.input[0].content[1].type, "input_image");
    assert.equal("previous_response_id" in json, false);
    return response(body);
  });
  const deltas: string[] = [];
  const usage: Usage[] = [];
  const result = await provider.generate(request, "fixture-key-in-memory", new AbortController().signal,
    (delta) => deltas.push(delta), (u) => usage.push(u));
  assert.deepEqual(deltas, ["凝视", "模型"]);
  assert.equal(result.text, "凝视模型");
  assert.deepEqual(usage, [{ inputTokens: 11, outputTokens: 7, cachedTokens: 3 }]);
});

test("incomplete, refusal, auth, quota, and dropped streams surface safe failures", async () => {
  const signal = new AbortController().signal;
  const cases: Array<[Response, string]> = [
    [response(wire({ type: "response.incomplete", response: complete.response })), "incomplete"],
    [response(wire({ type: "response.refusal.delta", delta: "declined" }) + wire(complete)), "refusal"],
    [response("private raw message", 401), "auth"],
    [response("private raw message", 404), "model-unavailable"],
    [response('{"error":{"code":"insufficient_quota","message":"private raw message"}}', 429), "quota"],
    [response(wire({ type: "response.output_text.delta", delta: "partial" }) + "data: [DONE]\n\n"), "stream"],
  ];
  for (const [fixture, code] of cases) {
    const provider = new OpenAIProvider(async () => fixture);
    await assert.rejects(provider.generate(request, "fixture-key-in-memory", signal, noop, noop),
      (err) => err instanceof CopilotError && err.code === code && !err.message.includes("private raw"));
  }
});

test("cancellation aborts streaming transport", async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(async (_url, options) => response(new ReadableStream({
    start(stream) {
      options?.signal?.addEventListener("abort", () => stream.error(options.signal?.reason), { once: true });
      stream.enqueue(encoder.encode(wire({ type: "response.output_text.delta", delta: "partial" })));
    },
  })));
  await assert.rejects(provider.generate(request, "fixture-key-in-memory", controller.signal, () => controller.abort(), noop),
    { name: "AbortError" });
});

test("API connection test sends one small text-only Responses request with the selected model", async () => {
  let requests = 0;
  const provider = new OpenAIProvider(async (url, options) => {
    requests++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer fixture-key-in-memory");
    assert.deepEqual(JSON.parse(String(options?.body)), {
      model: "gpt-6-luna",
      instructions: "Reply with only OK.",
      input: [{
        role: "user",
        content: [{ type: "input_text", text: "Zotero Research Copilot API connection test." }],
      }],
      stream: true,
      store: false,
      max_output_tokens: 256,
    });
    return response(wire({ type: "response.output_text.delta", delta: "OK" }) + wire(complete));
  });
  const usage = await testOpenAIConnection(provider, "gpt-6-luna", "fixture-key-in-memory", new AbortController());
  assert.equal(requests, 1);
  assert.equal(usage?.outputTokens, 7);
});

test("API connection test aborts an unresponsive request after 30 seconds", async ({ mock }) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const provider = new OpenAIProvider(async (_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const pending = testOpenAIConnection(provider, "gpt-6-luna", "fixture-key-in-memory", new AbortController());
  const rejection = assert.rejects(pending, (error) => error instanceof CopilotError && error.code === "timeout");
  mock.timers.tick(30_000);
  await rejection;
});
