import assert from "node:assert/strict";
import { test } from "node:test";
import { PaperIndex } from "../src/paper/index.ts";
import { retrieve } from "../src/paper/retrieve.ts";
import { pagesFromFullText, pagesFromSdt } from "../src/paper/text.ts";
import { ANALYSIS_SECTIONS } from "../src/research/sections.ts";
import { buildRequest } from "../src/research/prompts.ts";

const fixture = { title: "Fixture", itemID: 777, libraryID: 898, attachmentKey: "ABCDEFGH" };

test("native fulltext never shifts physical pages when Zotero trims an outer blank page", () => {
  assert.deepEqual(pagesFromFullText("Methods\fResults", 3), []);
  const pages = pagesFromFullText("\f1. Methodology\nThe gaze encoder.\f2. Results\nAccuracy is 72%.", 3);
  assert.equal(pages[0]?.blocks.length, 0);
  assert.equal(pages[1]?.pageIndex, 1);
  assert.deepEqual(pages[1]?.blocks.map(({ kind }) => kind), ["heading", "paragraph"]);
  assert.equal(pages[2]?.blocks[1]?.text, "Accuracy is 72%.");
});

test("SDT keeps native page labels, text and anchored list items and rejects ambiguous pages", () => {
  const pages = pagesFromSdt({
    schemaVersion: "1.2.0",
    catalog: { pages: [{ label: "iv" }, { label: "1" }, { label: "2" }] },
    content: [
      { type: "heading", anchor: { pageRects: [[1, 0, 0, 1, 1]] }, content: [{ text: "3 Methodology" }] },
      { type: "paragraph", anchor: { pageRects: [[0], [1]] }, content: [{ text: "Ambiguous" }] },
      { type: "list", content: [{ type: "listitem", anchor: { pageRects: [[2]] }, content: [{ text: "Ablation result" }] }] },
    ],
  }, 3);
  assert.equal(pages[0]?.blocks.length, 0);
  assert.equal(pages[1]?.label, "1");
  assert.equal(pages[1]?.blocks[0]?.kind, "heading");
  assert.equal(pages[2]?.blocks[0]?.text, "Ablation result");
});

test("Chinese question ranks English ablation evidence and selection retrieves nearby context", () => {
  const pages = pagesFromFullText("1. Introduction\nWe study gaze estimation.\f3. Methodology\nThe encoder uses a 64-dimensional state.\nThe decoder predicts a fixation.\f4. Ablation Studies\nRemoving the encoder reduces accuracy by 2 percent.", 3);
  const index = new PaperIndex(pages, 3, "pdf-worker");
  const qa = retrieve(index, fixture, "论文的消融实验说明什么？", "question");
  const first = qa.evidence[0]?.source;
  assert.equal(first?.kind === "pdf" && first.location.pageIndex, 2);
  const selection = retrieve(index, fixture, "公式和模型", "selection", { text: "The encoder uses a 64-dimensional state.", pageIndex: 1 });
  const selected = selection.evidence[0]?.source;
  assert.equal(selected?.kind === "pdf" && selected.excerpt, "The encoder uses a 64-dimensional state.");
  assert.ok(selection.evidence.some(({ source }) => source.kind === "pdf" && source.excerpt.includes("decoder")));
});

test("deep analysis spreads retrieval across sections and limits prompt size", () => {
  const pages = ANALYSIS_SECTIONS.map((section, pageIndex) => ({
    pageIndex, blocks: Array.from({ length: 14 }, (_, n) => ({
      kind: "paragraph" as const,
      text: `${section.query} evidence block ${n}. ${"body text ".repeat(95)}`,
    })),
  }));
  const index = new PaperIndex(pages, pages.length, "sdt");
  const retrieval = retrieve(index, fixture, "Deep analysis", "analysis");
  const sources = retrieval.evidence.flatMap(({ source }) => source.kind === "pdf" ? [source.location.pageIndex] : []);
  assert.equal(new Set(sources).size, 10);
  assert.ok(retrieval.textChars <= 22_000);
  assert.ok(retrieval.evidence.length < index.chunks.length);
  const request = buildRequest({
    model: "gpt-5-mini", mode: "analysis", language: "zh", question: "分析",
    paper: fixture,
    retrieval, history: [],
  });
  const payload = JSON.parse(request.text);
  assert.equal(payload.paper_title, "Fixture");
  assert.equal(payload.evidence.length, retrieval.evidence.length);
  assert.deepEqual(payload.analysis_coverage.excerpt_pages, [...new Set(sources.map((page) => page + 1))]);
  assert.equal(retrieval.evidence[0]?.attachment.attachmentKey, "ABCDEFGH");
  assert.ok(!request.text.includes("ABCDEFGH"));
  assert.match(request.instructions, /10\. Open Questions/u);
  assert.match(request.instructions, /Mechanism Flow/u);
  assert.match(request.instructions, /\[Research proposal\]/u);
});

test("analysis keeps neighboring definitions, captions and appendices in source order", () => {
  const pages = pagesFromFullText([
    "Abstract: We study fixation prediction.",
    "2. Methodology\nThe gaze encoder defines the prior.\nL = −log p(y).\nHere y is the target fixation.\nFig. 2: The encoder feeds the decoder.",
    "3. Results\nTable 1: Held-out subject split.\nBaseline scores 70 and the encoder scores 72.",
    "References\nResearch ablation dataset loss baseline paper.",
    "Appendix A\nTraining uses a fixed seed and 20 epochs.",
  ].join("\f"), 5);
  pages[1]!.blocks[2]!.kind = "math";
  const index = new PaperIndex(pages, 8, "pdf-worker");
  const result = retrieve(index, fixture, "Deep analysis", "analysis");
  const excerpts = result.evidence.flatMap(({ source }) => source.kind === "pdf" ? [source] : []);
  const equation = excerpts.findIndex(({ blockKind }) => blockKind === "math");
  assert.ok(equation > 0);
  assert.match(excerpts[equation + 1]?.excerpt ?? "", /target fixation/u);
  assert.ok(excerpts.some(({ blockKind, excerpt }) => blockKind === "caption" && excerpt.startsWith("Fig. 2")));
  assert.ok(excerpts.some(({ section, excerpt }) => section === "appendix" && excerpt.includes("20 epochs")));
  assert.ok(excerpts.every(({ blockKind, section }) => blockKind !== "heading" && section !== "references"));
  assert.deepEqual(result.analysis, {
    totalPages: 8, indexedPages: 5, limited: true,
    suppliedPages: [1, 2, 3, 5], suppliedSections: ["abstract", "method", "results", "appendix"],
    hasBodyText: true,
  });
});
