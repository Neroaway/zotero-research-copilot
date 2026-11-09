import assert from "node:assert/strict";
import { test } from "node:test";
import type { AIProvider } from "../src/ai/provider.ts";
import { PaperIndex } from "../src/paper/index.ts";
import { pagesFromFullText } from "../src/paper/text.ts";
import type { Evidence } from "../src/paper/types.ts";
import { parseAnalysis, verifyEvidenceLabels } from "../src/research/analysis.ts";
import { branchNodes } from "../src/research/mind-map.ts";
import { ResearchSession } from "../src/research/session.ts";
import { Settings } from "../src/storage/settings.ts";
import { renderMarkdown, usedCitations } from "../src/ui/markdown.ts";

const key = "fixture-key-only";
const evidence: Evidence[] = [{
  id: "E1", attachment: { itemID: 2, libraryID: 1, attachmentKey: "ABCDEFGH" },
  source: { kind: "pdf", location: { pageIndex: 1 }, block: 4, excerpt: "Fixture source" },
}];

test("credentials use OS ciphertext or a session fallback and can be cleared", async () => {
  const values = new Map<string, string>();
  const prefs = {
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => { values.set(name, value); },
    clear: (name: string) => { values.delete(name); },
  };
  const safe = {
    available: true,
    isEncrypted: (value: unknown) => typeof value === "string" && value.startsWith("fixture-cipher:"),
    encrypt: async () => "fixture-cipher:opaque",
    decrypt: async () => key,
  };
  const settings = new Settings(prefs, safe);
  assert.equal(await settings.saveKey(key, true), "encrypted");
  assert.ok(![...values.values()].includes(key));
  assert.equal(await new Settings(prefs, safe).getKey(), key);
  const unavailable = new Settings(prefs, { ...safe, encrypt: async () => { throw new Error("locked"); } });
  assert.equal(await unavailable.saveKey(key, true), "session");
  assert.equal(values.size, 0);
  assert.equal(await unavailable.getKey(), key);
  await unavailable.clearKey();
  assert.equal(await unavailable.getKey(), undefined);
  assert.equal(await new Settings(prefs).getKey(), undefined);
});

test("evidence labels and Markdown keep local citations, ignore code markers, and escape model HTML", () => {
  const text = [
    "**[Paper evidence]** A supported claim [[E1]].",
    "**[Paper evidence]** A claim with missing source [[E999]].",
    "**[Inference]** Let $x_t$ be the state.",
    "<img src=x onerror=alert(1)> [bad](javascript:alert(1)) ![bad](https://example.invalid/a.png)",
    "```python\nprint('[[E3]]')\n```",
    "\\[\nL = \\sum_i x_i\n\\]",
  ].join("\n\n");
  const checked = verifyEvidenceLabels(text, evidence);
  const html = renderMarkdown(checked, evidence, "zh");
  assert.match(html, /zrc-label-paper/u);
  assert.match(html, /zrc-label-missing/u);
  assert.match(html, /来源未核实/u);
  assert.match(html, /模型未标注依据/u);
  assert.match(html, /class="zrc-cite-slot">E1</u);
  assert.match(html, /class="katex"/u);
  assert.match(html, /class="katex-display"/u);
  assert.doesNotMatch(html, /<img |<a /u);
  assert.deepEqual([...usedCitations(checked)], ["E1", "E999"]);
  const note = renderMarkdown(checked, evidence, "en", () => "zotero://open-pdf/library/items/ABCDEFGH?page=2");
  assert.match(note, /zotero:\/\/open-pdf.*page=2/u);
  assert.doesNotMatch(note, /class="katex"/u);
});

test("mind map derives ten branches with honest missing states and intact multi-line formula nodes", () => {
  const branches = parseAnalysis("## 1. Research Problem\n- First.\n- Second.\n\n## 5. Mathematical Formulation\n- Loss.\n\n$$\nx+y\n$$\n\n## 10. Open Questions\nTest it.");
  assert.equal(branches.length, 10);
  assert.equal(branches.filter(({ missing }) => missing).length, 7);
  assert.deepEqual(branchNodes(branches[0]!.markdown), ["First.", "Second."]);
  assert.ok(branchNodes(branches[4]!.markdown).some((node) => node.includes("$$\nx+y\n$$")));
});

test("proposal and table evidence labels are checked per finding", () => {
  const image: Evidence = { ...evidence[0]!, id: "E2", source: { kind: "upload" } };
  const text = [
    "| Finding | Source |",
    "| --- | --- |",
    "| **[Paper evidence]** A | [[E1]] |",
    "| **[Paper evidence]** B | [[E999]] |",
    "",
    "- **[Research proposal]** Hold the split fixed and test the decoder. [[E1]]",
    "- **[Research proposal]** Change the encoder using an unlocated screenshot. [[E2]]",
  ].join("\n");
  const checked = verifyEvidenceLabels(text, [...evidence, image]);
  assert.match(checked, /\[Paper evidence\]\*\* A/u);
  assert.match(checked, /\[Unsupported claim\]\*\* B/u);
  assert.match(checked, /\[Research proposal\]\*\* Hold/u);
  assert.match(checked, /\[Unanchored proposal\]\*\* Change/u);
  assert.match(renderMarkdown(checked, [...evidence, image], "zh"), /改进建议 · 待验证/u);
  assert.match(renderMarkdown(checked, [...evidence, image], "zh"), /改进建议缺少论文依据/u);
});

test("abstract-only documents support questions but cannot generate a deep analysis", async () => {
  const session = new ResearchSession();
  const pages = pagesFromFullText("Research task and objective\nAbstract: We study gaze tracking and report a preliminary result.", 1);
  let requests = 0;
  const provider: AIProvider = {
    async generate() {
      requests++;
      return { text: "**[Paper evidence]** The abstract studies gaze tracking. [[E1]]" };
    },
  };
  const options = {
    provider, settings: { model: "gpt-5-mini", getKey: async () => key },
    source: {
      paper: { title: "Fixture", itemID: 2, libraryID: 1, attachmentKey: "ABCDEFGH" },
      load: async () => ({ index: new PaperIndex(pages, 1, "pdf-worker"), version: 42 }),
    },
    language: "en" as const, onChange: () => {},
  };
  await session.run({
    ...options, controller: new AbortController(),
    task: { mode: "analysis", question: "Analyze this paper", visual: { kind: "upload", dataURL: "data:image/png;base64,AA==" } },
  });
  assert.equal(session.turns[0]?.error?.code, "insufficient-analysis-text");
  assert.equal(requests, 0);
  await session.run({
    ...options, controller: new AbortController(),
    task: { mode: "question", question: "What does the abstract report?" },
  });
  assert.equal(session.turns[1]?.phase, "done");
  assert.equal(requests, 1);
});

test("session scopes history to completed turns, retains failed input for retry and re-reads model choice", async () => {
  const session = new ResearchSession();
  const load = async () => ({ index: new PaperIndex(pagesFromFullText("Gaze encoder uses a recurrent state.", 1), 1, "pdf-worker"), version: 42 });
  let requestCount = 0;
  let model = "gpt-5-mini";
  const provider: AIProvider = {
    async generate(request, _key, _signal, delta) {
      const { recent_conversation: history } = JSON.parse(request.text);
      requestCount++;
      assert.equal(history.length, requestCount === 1 ? 0 : 1);
      assert.ok(!JSON.stringify(history).includes("[[E1]]"));
      assert.equal(request.model, model);
      if (requestCount === 2) throw new Error("fixture error");
      const text = "**[Paper evidence]** Gaze encoder [[E1]]";
      delta(text);
      return { text };
    },
  };
  const run = (question?: string) => session.run({
    provider, settings: { get model() { return model; }, getKey: async () => key },
    source: { paper: { title: "Fixture", itemID: 2, libraryID: 1, attachmentKey: "ABCDEFGH" }, load },
    language: "en", controller: new AbortController(), onChange: () => {},
    task: question ? { mode: "question", question } : undefined,
  });
  await run("Explain gaze encoder");
  await run("How is the state used?");
  assert.equal(session.turns.at(-1)?.phase, "failed");
  assert.ok(session.canRetry);
  model = "gpt-5.4-mini";
  await run();
  assert.equal(session.turns.length, 2);
  assert.equal(session.turns.at(-1)?.phase, "done");
  assert.equal(session.turns.at(-1)?.model, model);
});
