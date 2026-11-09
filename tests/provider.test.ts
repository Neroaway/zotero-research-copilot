import assert from "node:assert/strict";
import { test } from "node:test";
import { testConnection } from "../src/ai/connection.ts";
import { providerFactory } from "../src/ai/provider-factory.ts";
import { providerConnection } from "../src/ai/providers.ts";
import type { ProviderID } from "../src/ai/providers.ts";
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

test("API-default output budget omits the local cap and reports reasoning-only exhaustion", async () => {
  const provider = new OpenAIProvider(async (_url, options) => {
    const payload = JSON.parse(String(options?.body));
    assert.ok(!Object.hasOwn(payload, "max_output_tokens"));
    assert.equal(payload.reasoning?.effort, "max");
    return response(wire({
      type: "response.incomplete",
      response: {
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 4726, output_tokens: 7000, output_tokens_details: { reasoning_tokens: 7000 } },
      },
    }));
  });
  const usage: Usage[] = [];
  await assert.rejects(provider.generate(
    { ...request, model: "gpt-6.1-sol", reasoningEffort: "max", maxOutputTokens: undefined },
    "fixture-key-in-memory", new AbortController().signal,
    () => assert.fail("A reasoning-only response produced answer text"),
    (value) => usage.push(value),
  ), (error) => error instanceof CopilotError && error.code === "output-limit");
  assert.equal(usage[0]?.outputTokens, 7000);
  assert.equal(usage[0]?.reasoningTokens, 7000);
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
  const usage = await testConnection(provider, "gpt-6-luna", "fixture-key-in-memory", new AbortController());
  assert.equal(requests, 1);
  assert.equal(usage?.outputTokens, 7);
});

test("API connection test aborts an unresponsive request after 30 seconds", async ({ mock }) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const provider = new OpenAIProvider(async (_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const pending = testConnection(provider, "gpt-6-luna", "fixture-key-in-memory", new AbortController());
  const rejection = assert.rejects(pending, (error) => error instanceof CopilotError && error.code === "timeout");
  mock.timers.tick(30_000);
  await rejection;
});

test("account model discovery reads the OpenAI catalog with a bodyless authenticated GET", async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options?.method, "GET");
    assert.equal(options?.body, undefined);
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer fixture-key-in-memory");
    return new Response(JSON.stringify({ data: [{ id: "gpt-6.1-terra" }, { id: 7 }, null] }));
  });
  assert.deepEqual(await provider.listModels("fixture-key-in-memory", controller.signal), ["gpt-6.1-terra"]);
  const malformed = new OpenAIProvider(async () => new Response(JSON.stringify({ data: "invalid" })));
  await assert.rejects(malformed.listModels("fixture-key-in-memory", controller.signal),
    (error) => error instanceof CopilotError && error.code === "model-list");
});

function connection(id: ProviderID, baseURL?: string) {
  const value = providerConnection(id, baseURL);
  assert.ok(value);
  return value;
}

test("DeepSeek and Grok send Responses to their own endpoints, including image input", async () => {
  const cases = [
    { id: "deepseek", base: "https://api.deepseek.com", model: "deepseek-flash", effort: "max" },
    { id: "grok", base: "https://api.x.ai/v1", model: "grok-4.7", effort: "xhigh" },
  ] as const;
  for (const { id, base, model, effort } of cases) {
    const provider = providerFactory(async (url, options) => {
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer fixture-key-in-memory");
      if (options?.method === "GET") {
        assert.equal(url, base + "/models");
        return Response.json({ data: [{ id: model }] });
      }
      assert.equal(url, base + "/responses");
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.model, model);
      assert.deepEqual(payload.reasoning, { effort });
      assert.equal(payload.store, false);
      assert.equal(payload.input[0].content[1].image_url, request.imageURL);
      return response(wire({ type: "response.output_text.delta", delta: "Grounded answer" }) + wire(complete));
    })(connection(id));
    const signal = new AbortController().signal;
    assert.deepEqual(await provider.listModels("fixture-key-in-memory", signal), [model]);
    const result = await provider.generate({ ...request, model, reasoningEffort: effort }, "fixture-key-in-memory", signal, noop, noop);
    assert.equal(result.text, "Grounded answer");
  }
  const provider = providerFactory(async () => assert.fail("Sent an image to a known text-only model"))(connection("deepseek"));
  await assert.rejects(provider.generate({ ...request, model: "deepseek-v4-pro" }, "fixture-key-in-memory",
    new AbortController().signal, noop, noop), (error) => error instanceof CopilotError && error.code === "image-model");
});

test("Claude uses native Messages auth, effort, images and cumulative streaming usage", async () => {
  const model = "claude-sonnet-5-5";
  const stream = [
    { type: "message_start", message: { usage: { input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 } } },
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private reasoning fixture" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Paper evidence." } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ].map(wire).join("");
  const provider = providerFactory(async (url, options) => {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("x-api-key"), "fixture-key-in-memory");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.equal(headers.get("authorization"), null);
    if (options?.method === "GET") {
      assert.equal(url, "https://api.anthropic.com/v1/models?limit=1000");
      return Response.json({ data: [{ id: model }] });
    }
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.system, request.instructions);
    assert.equal(payload.max_tokens, request.maxOutputTokens);
    assert.deepEqual(payload.output_config, { effort: "max" });
    assert.deepEqual(payload.messages, [{ role: "user", content: [
      { type: "text", text: request.text },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AA==" } },
    ] }]);
    return response(stream);
  })(connection("claude"));
  const signal = new AbortController().signal;
  assert.deepEqual(await provider.listModels("fixture-key-in-memory", signal), [model]);
  const deltas: string[] = [];
  const result = await provider.generate({ ...request, model, reasoningEffort: "max" }, "fixture-key-in-memory",
    signal, (delta) => deltas.push(delta), noop);
  assert.deepEqual(deltas, ["Paper evidence."]);
  assert.deepEqual(result, { text: "Paper evidence.", usage: { inputTokens: 15, outputTokens: 10, cachedTokens: 5 } });
});

test("Claude distinguishes token exhaustion, provider errors and streams missing message_stop", async () => {
  const limit = [
    { type: "message_start", message: { usage: { input_tokens: 11 } } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 7000 } },
  ].map(wire).join("");
  for (const [stream, code] of [
    [limit + wire({ type: "message_stop" }), "output-limit"],
    [limit, "stream"],
    [wire({ type: "error", error: { type: "overloaded_error", message: "private error fixture" } }), "server"],
  ]) {
    const provider = providerFactory(async (_url, options) => {
      assert.ok(JSON.parse(String(options?.body)).max_tokens > 0, "Claude requires a finite token budget");
      return response(stream ?? "");
    })(connection("claude"));
    await assert.rejects(provider.generate({ ...request, maxOutputTokens: undefined }, "fixture-key-in-memory",
      new AbortController().signal, () => assert.fail("Generated visible text"), noop),
    (error) => error instanceof CopilotError && error.code === code);
  }
});

test("MiMo and a custom Chat Completions endpoint support models, images and streamed usage", async () => {
  const cases = [
    { id: "mimo", base: "https://api.xiaomimimo.com/v1", model: "mimo-v2.6-flash", field: "max_completion_tokens" },
    { id: "compatible", base: "https://example.invalid/api/v1", model: "vendor/vision-model", field: "max_tokens" },
  ] as const;
  const stream = [
    { choices: [{ delta: { reasoning_content: "private reasoning fixture" } }] },
    { choices: [{ delta: { content: "Caption." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 17, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 4 } } },
  ].map(wire).join("") + "data: [DONE]\n\n";
  for (const { id, base, model, field } of cases) {
    const provider = providerFactory(async (url, options) => {
      assert.equal(options?.redirect, "error");
      assert.equal(new Headers(options?.headers).get("authorization"), "Bearer fixture-key-in-memory");
      if (options?.method === "GET") {
        assert.equal(url, base + "/models");
        return Response.json({ data: [{ id: model }] });
      }
      assert.equal(url, base + "/chat/completions");
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload[field], request.maxOutputTokens);
      assert.equal(payload.stream, true);
      assert.deepEqual(payload.messages[1].content[1], { type: "image_url", image_url: { url: request.imageURL } });
      assert.deepEqual(payload.thinking, id === "mimo" ? { type: "disabled" } : undefined);
      return response(stream);
    })(connection(id, base));
    const signal = new AbortController().signal;
    assert.deepEqual(await provider.listModels("fixture-key-in-memory", signal), [model]);
    const deltas: string[] = [];
    const result = await provider.generate({ ...request, model, reasoningEffort: "none" }, "fixture-key-in-memory",
      signal, (delta) => deltas.push(delta), noop);
    assert.deepEqual(deltas, ["Caption."]);
    assert.equal(result.text, "Caption.");
    assert.equal(result.usage?.reasoningTokens, 4);
  }
});

test("Chat Completions keeps streamed text but rejects truncated and dropped streams", async () => {
  for (const [finish_reason, code] of [["length", "output-limit"], [null, "stream"], ["content_filter", "refusal"]] as const) {
    const provider = providerFactory(async () => response(wire({ choices: [{ delta: { content: "partial" }, finish_reason }] })))(
      connection("mimo"));
    const deltas: string[] = [];
    await assert.rejects(provider.generate(request, "fixture-key-in-memory", new AbortController().signal,
      (delta) => deltas.push(delta), noop), (error) => error instanceof CopilotError && error.code === code);
    assert.deepEqual(deltas, ["partial"]);
  }
});
