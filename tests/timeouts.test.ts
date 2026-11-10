import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider, AIResult } from "../src/ai/provider.ts";
import { providerConnection } from "../src/ai/providers.ts";
import { PaperIndex } from "../src/paper/index.ts";
import { pagesFromFullText } from "../src/paper/text.ts";
import { ResearchSession } from "../src/research/session.ts";
import type { StopReason } from "../src/research/session.ts";
import { requestTimeoutMs } from "../src/research/timeouts.ts";
import { encodeConversation, decodeConversation } from "../src/storage/conversations.ts";
import { Settings } from "../src/storage/settings.ts";

const paper = { itemID: 2, libraryID: 1, attachmentKey: "ABCDEFGH", title: "Fixture" };
const source = {
  paper,
  load: async () => ({ index: new PaperIndex(pagesFromFullText("1. Methodology\nThe encoder uses a recurrent state.", 1), 1, "pdf-worker"), version: 42 }),
};

function heldProvider() {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let finish!: (result: AIResult) => void;
  const provider: AIProvider = {
    generate: async () => new Promise<AIResult>((resolve) => { finish = resolve; started(); }),
  };
  return { provider, ready, finish: () => finish({ text: "**[Paper evidence]** Encoder [[E1]]" }) };
}

test("maximum answer wait is saved per provider and custom endpoint independently of output budgets", () => {
  const values = new Map<string, string>();
  const prefs = { get: (name: string) => values.get(name), set: (name: string, value: string) => { values.set(name, value); }, clear: (name: string) => { values.delete(name); } };
  const settings = new Settings(prefs);
  const openai = providerConnection("openai")!;
  const claude = providerConnection("claude")!;
  const local = providerConnection("compatible", "http://localhost:11434/v1")!;
  const remote = providerConnection("compatible", "https://example.invalid/v1")!;
  assert.equal(settings.responseTimeoutFor(openai), "none");
  settings.setResponseTimeout("60", openai);
  settings.setResponseTimeout("20", local);
  const restored = new Settings(prefs);
  assert.equal(restored.responseTimeoutFor(openai), "60");
  assert.equal(restored.responseTimeoutFor(local), "20");
  assert.equal(restored.responseTimeoutFor(remote), "none");
  assert.equal(restored.responseTimeoutFor(claude), "none");
  assert.equal(restored.analysisBudgetFor(openai), "auto");
  restored.setResponseTimeout("unlimited", openai);
  assert.equal(restored.responseTimeoutFor(openai), "none");
});

test("Max deep analysis keeps waiting beyond ten minutes without changing the reasoning or output budget", async ({ mock }) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const session = new ResearchSession();
  const held = heldProvider();
  const pending = session.run({
    source, provider: held.provider, connection: providerConnection("openai"),
    settings: { model: "gpt-6.1-sol", reasoningEffort: "max", responseTimeout: "auto", getKey: async () => "fixture-key" },
    language: "zh", controller: new AbortController(), onChange: () => {},
    task: { mode: "analysis", question: "Analyze the method" },
  });
  await held.ready;
  mock.timers.tick(600_000);
  assert.equal(session.busy, true);
  assert.equal(session.turns[0]?.phase, "streaming");
  assert.equal(session.turns[0]?.timing?.timeoutMs, 1_800_000);
  assert.equal(session.turns[0]?.timing?.maxOutputTokens, 32_000);
  held.finish();
  await pending;
  assert.equal(session.turns[0]?.phase, "done");
  assert.equal(session.turns[0]?.reasoningEffort, "max");
  assert.equal(session.turns[0]?.timing?.finishedAt, 601_000);
});

test("an explicit timeout is recorded as a timeout even if the native controller loses its custom reason", async ({ mock }) => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const session = new ResearchSession();
  const held = heldProvider();
  const controller = new AbortController();
  const abort = controller.abort.bind(controller);
  controller.abort = () => abort();
  const pending = session.run({
    source, provider: held.provider,
    settings: { model: "gpt-6.1-sol", reasoningEffort: "max", responseTimeout: "10", getKey: async () => "fixture-key" },
    language: "en", controller, onChange: () => {}, task: { mode: "analysis", question: "Analyze the method" },
  });
  await held.ready;
  mock.timers.tick(600_000);
  await pending;
  const [restored] = decodeConversation(paper, encodeConversation(paper, session.turns));
  assert.equal(restored?.phase, "failed");
  assert.equal(restored?.error?.code, "timeout");
  assert.equal(restored?.stopReason, undefined);
  assert.equal(restored?.timing?.timeoutMs, 600_000);
  assert.equal(restored?.timing?.finishedAt, 601_000);
  assert.equal(session.busy, false);
  assert.equal(session.canRetry, true);
});

test("manual stops and reader/plugin teardown persist their own interruption causes and elapsed times", async () => {
  for (const reason of ["user", "reader-closed", "reader-unloaded", "plugin-unloaded"] satisfies StopReason[]) {
    const session = new ResearchSession();
    const held = heldProvider();
    const pending = session.run({
      source, provider: held.provider, settings: { model: "gpt-6.1-sol", reasoningEffort: "max", getKey: async () => "fixture-key" },
      language: "zh", controller: new AbortController(), onChange: () => {}, task: { mode: "analysis", question: "Analyze" },
    });
    await held.ready;
    session.stop(reason);
    // Teardown snapshots before the asynchronous abort catch has run.
    const saved = encodeConversation(paper, session.turns);
    session.dispose();
    await pending;
    const [restored] = decodeConversation(paper, saved);
    assert.equal(restored?.phase, "stopped");
    assert.equal(restored?.stopReason, reason);
    assert.ok(restored?.timing?.finishedAt);
    assert.equal(restored?.error, undefined);
  }
});

test("all answer types default to no local timeout; explicit and automatic limits apply when selected", () => {
  for (const mode of ["analysis", "question", "selection"] as const) {
    assert.equal(requestTimeoutMs(mode, "max"), undefined);
    assert.equal(requestTimeoutMs(mode, "max", "none"), undefined);
    assert.equal(requestTimeoutMs(mode, "max", "60"), 3_600_000);
  }
  assert.equal(requestTimeoutMs("analysis", "xhigh", "auto"), 1_800_000);
  assert.equal(requestTimeoutMs("analysis", "high", "auto"), 600_000);
  assert.equal(requestTimeoutMs("analysis", "max", "60"), 3_600_000);
  assert.equal(requestTimeoutMs("question", "max", "auto"), 240_000);
  assert.equal(requestTimeoutMs("selection", "max", "auto"), 240_000);
});

test("default questions, selections and analyses keep running beyond the old local deadlines", async ({ mock }) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  for (const mode of ["question", "selection", "analysis"] as const) {
    const session = new ResearchSession();
    const held = heldProvider();
    const pending = session.run({
      source, provider: held.provider, settings: { model: "gpt-6.1-sol", reasoningEffort: "max", getKey: async () => "fixture-key" },
      language: "zh", controller: new AbortController(), onChange: () => {}, task: { mode, question: "Explain the encoder" },
    });
    await held.ready;
    mock.timers.tick(3_600_000);
    assert.equal(session.busy, true);
    assert.equal(session.turns[0]?.timing?.timeoutMs, undefined);
    held.finish();
    await pending;
    assert.equal(session.turns[0]?.phase, "done");
  }
});
