import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider } from "../src/ai/provider.ts";
import { providerConnection } from "../src/ai/providers.ts";
import { CopilotError } from "../src/errors.ts";
import { PaperIndex } from "../src/paper/index.ts";
import { pagesFromFullText } from "../src/paper/text.ts";
import { ResearchSession } from "../src/research/session.ts";
import type { Turn } from "../src/research/session.ts";
import { ConversationStore, decodeConversation, encodeConversation } from "../src/storage/conversations.ts";
import type { ConversationFiles } from "../src/storage/conversations.ts";

const paper = { title: "Fixture", itemID: 2, libraryID: 1, attachmentKey: "ABCDEFGH" };
const connection = providerConnection("openai")!;
const turn = (): Turn => ({
  mode: "analysis", question: "Analyze the encoder", model: "gpt-6.1-sol", connection,
  language: "zh", reasoningEffort: "max", phase: "done", version: 42, contextChars: 100,
  text: "## 5. Mathematical Formulation\n\n**[Paper evidence]** The **encoder** state is $x_t$. [[E1]]",
  evidence: [{ id: "E1", attachment: paper, source: { kind: "pdf", location: { pageIndex: 1, annotationKey: "QWERTYUI" }, excerpt: "Encoder state" } }],
  usage: { inputTokens: 30, outputTokens: 40, reasoningTokens: 20 },
  index: { totalPages: 2, indexedPages: 2, limited: false, method: "sdt" },
  analysisCoverage: { totalPages: 2, indexedPages: 2, limited: false, suppliedPages: [1], suppliedSections: ["method"], hasBodyText: true },
});

function memoryFiles(): ConversationFiles & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data, read: async (name) => data.get(name),
    write: async (name, json) => { data.set(name, json); },
    remove: async (name) => { data.delete(name); },
  };
}

test("a fresh conversation store restores answers, formulas, evidence, usage and derived mind maps", async () => {
  const files = memoryFiles();
  const original = turn();
  Object.assign(original, { apiKey: "secret-fixture", task: { visual: { dataURL: "data:image/png;base64,private" } } });
  await new ConversationStore(files).save(paper, [original]);
  const saved = [...files.data.values()][0]!;
  assert.doesNotMatch(saved, /secret-fixture|data:image|"task"|"branches"/u);
  const [restored] = await new ConversationStore(files).load({ ...paper, itemID: 222 });
  assert.equal(restored?.phase, "done");
  assert.equal(restored?.text, original.text);
  assert.equal(restored?.reasoningEffort, "max");
  assert.deepEqual(restored?.usage, original.usage);
  assert.deepEqual(restored?.analysisCoverage, original.analysisCoverage);
  assert.equal(restored?.branches?.length, 10);
  assert.equal(restored?.branches?.[4]?.missing, false);
  assert.equal(restored?.evidence[0]?.attachment.itemID, 222);
  assert.equal(restored?.evidence[0]?.source.kind, "pdf");
});

test("conversations are isolated by attachment key and library, and clearing removes persisted history", async () => {
  const files = memoryFiles();
  const store = new ConversationStore(files);
  await store.save(paper, [turn()]);
  assert.deepEqual(await store.load({ ...paper, libraryID: 2 }), []);
  assert.deepEqual(await store.load({ ...paper, attachmentKey: "QWERTYUI" }), []);
  await store.save(paper, []);
  assert.equal(files.data.size, 0);
  assert.deepEqual(await new ConversationStore(files).load(paper), []);
});

test("close snapshots survive session disposal and an immediate reopen waits for the atomic write", async () => {
  const files = memoryFiles();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const store = new ConversationStore({ ...files, write: async (name, json) => { await held; await files.write(name, json); } });
  const session = new ResearchSession();
  session.restore([turn()]);
  const saving = store.save(paper, session.turns);
  session.dispose();
  const loading = store.load(paper);
  release();
  await saving;
  assert.equal((await loading)[0]?.question, "Analyze the encoder");
  const saveAgain = store.save(paper, [turn()]);
  const clear = store.save(paper, []);
  const loadAfterClear = store.load(paper);
  await Promise.all([saveAgain, clear, store.flush()]);
  assert.deepEqual(await loadAfterClear, []);
});

test("interrupted work restores as stopped without resending, while failed error messages survive serialization", () => {
  const partial = { ...turn(), phase: "streaming" as const, text: "Partial answer" };
  const failed = { ...turn(), phase: "failed" as const, error: new CopilotError("output-limit") };
  const restored = decodeConversation(paper, encodeConversation(paper, [partial, failed]));
  assert.equal(restored[0]?.phase, "stopped");
  assert.equal(restored[0]?.text, "Partial answer");
  assert.equal(restored[1]?.error?.code, "output-limit");
  const session = new ResearchSession();
  session.restore(restored);
  assert.equal(session.busy, false);
  assert.equal(session.canRetry, false);
});

test("corrupt, mismatched and unsupported history raises a restore error without erasing the file", async () => {
  const files = memoryFiles();
  const store = new ConversationStore(files);
  for (const json of [
    "{bad", JSON.stringify({ schemaVersion: 999, paper, turns: [] }),
    encodeConversation({ ...paper, attachmentKey: "QWERTYUI" }, [turn()]),
    encodeConversation(paper, [{ ...turn(), error: { code: "bad-error" } as unknown as CopilotError }]),
  ]) {
    files.data.set("1-ABCDEFGH.json", json);
    await assert.rejects(store.load(paper), { code: "history-read" });
    assert.equal(files.data.get("1-ABCDEFGH.json"), json);
  }
  await assert.rejects(store.save({ ...paper, attachmentKey: "../bad" }, []));
});

test("write failures are reported and do not poison later saves or clear operations", async () => {
  const files = memoryFiles();
  let fail = true;
  const store = new ConversationStore({ ...files, write: async (name, json) => {
    if (fail) throw new Error("disk full fixture");
    await files.write(name, json);
  } });
  await assert.rejects(store.save(paper, [turn()]), { code: "history-write" });
  fail = false;
  await store.save(paper, [turn()]);
  assert.equal((await store.load(paper)).length, 1);
  await store.save(paper, []);
  await store.flush();
  assert.equal(files.data.size, 0);
});

test("restored conversations inform follow-ups only for the same provider, endpoint and PDF version", async () => {
  const files = memoryFiles();
  await new ConversationStore(files).save(paper, [turn()]);
  const history: string[][] = [];
  const provider: AIProvider = {
    async generate(request) {
      history.push(JSON.parse(request.text).recent_conversation.map(({ question }: { question: string }) => question));
      return { text: "**[Paper evidence]** Encoder [[E1]]" };
    },
  };
  for (const [selected, version] of [[connection, 42], [providerConnection("claude")!, 42], [connection, 43]] as const) {
    const session = new ResearchSession();
    session.restore(await new ConversationStore(files).load(paper));
    await session.run({
      provider, connection: selected, settings: { model: "fixture", getKey: async () => "fixture-key" },
      source: { paper, load: async () => ({ index: new PaperIndex(pagesFromFullText("Encoder state", 1), 1, "pdf-worker"), version }) },
      language: "en", onChange: () => {}, controller: new AbortController(),
      task: { mode: "question", question: "What is its dimension?" },
    });
    assert.equal(session.turns.at(-1)?.phase, "done");
  }
  assert.deepEqual(history, [["Analyze the encoder"], [], []]);
});
