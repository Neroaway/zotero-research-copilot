import { ANALYSIS_SECTIONS } from "../research/sections.ts";
import { normalizeText } from "./text.ts";
import type { PaperIndex } from "./index.ts";
import type { Chunk, Evidence, Paper, Selection, SourceEvidence, VisualInput } from "./types.ts";

export const QUESTION_LIMIT = 3_000;
export const SELECTION_LIMIT = 2_800;
const CHAT_BUDGET = 8_000;
const ANALYSIS_BUDGET = 22_000;

export interface Retrieval {
  evidence: Evidence[];
  textChars: number;
}

function byScore(index: PaperIndex, scores: number[], boost: (chunk: Chunk) => number = () => 0) {
  return index.chunks.map((chunk, i) => ({
    chunk,
    i,
    score: (scores[i] ?? 0) + boost(chunk) - (chunk.section === "references" ? 4 : 0),
  })).sort((a, b) => b.score - a.score || a.i - b.i);
}

function forAnalysis(index: PaperIndex): Chunk[] {
  const candidates = ANALYSIS_SECTIONS.map(({ query, sections, title }) => byScore(
    index,
    index.rank(query),
    (chunk) => (sections as readonly string[]).includes(chunk.section)
      ? 3 + (title === "Mathematical Formulation" && chunk.kind === "math" ? 4 : 0)
      : 0,
  ).filter(({ chunk, score }) => score > 0 && chunk.section !== "references"));
  // Allocate the first pass across the ten topics before adding second and third hits.
  const selected = new Map<string, Chunk>();
  for (let pass = 0; pass < 3; pass++) {
    for (const ranking of candidates) {
      const next = ranking.find(({ chunk }) => !selected.has(chunk.id));
      if (next) selected.set(next.chunk.id, next.chunk);
    }
  }
  return [...selected.values()];
}

function condensed(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\u00ad]/gu, "");
}

function forQuestion(index: PaperIndex, query: string, selection?: Selection, visual?: VisualInput): Chunk[] {
  const queryScores = index.rank(query);
  const selectionScores = selection ? index.rank(selection.text) : [];
  const scores = queryScores.map((score, i) => score + (selectionScores[i] ?? 0) * 0.5);
  const focusPage = selection?.pageIndex ?? (visual?.kind === "page" ? visual.location.pageIndex : undefined);
  const focusEnd = selection?.endPageIndex ?? focusPage;
  const needle = selection && condensed(selection.text).slice(0, 180);
  const ranking = byScore(index, scores, (chunk) => {
    const inFocus = focusPage !== undefined && focusEnd !== undefined
      && chunk.pageIndex >= focusPage && chunk.pageIndex <= focusEnd;
    if (!inFocus) return 0;
    if (needle && condensed(chunk.text).includes(needle)) return 100;
    return chunk.kind === "heading" ? 1 : 4;
  });
  const selected = new Map<string, Chunk>();
  if (focusPage !== undefined) {
    const nearest = ranking.find(({ chunk }) => chunk.pageIndex === focusPage);
    if (nearest) {
      for (const i of [nearest.i, nearest.i - 1, nearest.i + 1]) {
        const chunk = index.chunks[i];
        if (chunk && Math.abs(chunk.pageIndex - focusPage) <= 1 && chunk.section !== "references") {
          selected.set(chunk.id, chunk);
        }
      }
    }
  }
  for (const { chunk, score } of ranking) {
    if (selected.size >= 10) break;
    if (score > 0) selected.set(chunk.id, chunk);
  }
  if (!selected.size) {
    const overview = index.chunks.filter((chunk) => chunk.section === "abstract" || chunk.section === "intro");
    for (const chunk of (overview.length ? overview : index.chunks).slice(0, 4)) selected.set(chunk.id, chunk);
  }
  return [...selected.values()];
}

export function retrieve(
  index: PaperIndex,
  paper: Paper,
  query: string,
  mode: "question" | "selection" | "analysis",
  selection?: Selection,
  visual?: VisualInput,
): Retrieval {
  const evidence: Evidence[] = [];
  const budget = mode === "analysis" ? ANALYSIS_BUDGET : CHAT_BUDGET;
  let textChars = 0;

  const { itemID, attachmentKey, libraryID } = paper;
  const attachment = { itemID, attachmentKey, libraryID };
  const add = (source: SourceEvidence) => {
    evidence.push({ id: `E${evidence.length + 1}`, attachment, source });
  };
  if (visual) {
    add(visual.kind === "page" ? { kind: "page-image", location: visual.location } : { kind: "upload" });
  }
  const selectedText = selection && normalizeText(selection.text).slice(0, SELECTION_LIMIT);
  if (selection && selectedText) {
    const { pageIndex, pageLabel, endPageIndex, annotationKey } = selection;
    add({ kind: "pdf", location: { pageIndex, pageLabel, endPageIndex, annotationKey }, excerpt: selectedText });
    textChars += selectedText.length;
  }

  const chunks = mode === "analysis" ? forAnalysis(index) : forQuestion(index, query, selection, visual);
  for (const chunk of chunks) {
    if (chunk.text.length + textChars > budget) continue;
    const { pageIndex, pageLabel, block, heading, text } = chunk;
    add({ kind: "pdf", location: { pageIndex, pageLabel }, block, heading, excerpt: text });
    textChars += text.length;
  }
  return { evidence, textChars };
}
