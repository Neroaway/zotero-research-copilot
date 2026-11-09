import { ANALYSIS_SECTIONS } from "../research/sections.ts";
import { normalizeText } from "./text.ts";
import type { PaperIndex } from "./index.ts";
import type { Chunk, Evidence, Paper, Section, Selection, SourceEvidence, VisualInput } from "./types.ts";

export const QUESTION_LIMIT = 3_000;
export const SELECTION_LIMIT = 2_800;
const CHAT_BUDGET = 8_000;
const ANALYSIS_BUDGET = 22_000;
const ANALYSIS_CHUNKS = 30;
const CONTEXT_SECTIONS = new Set<Section>(["method", "experiments", "results", "ablation", "appendix"]);

export interface AnalysisCoverage {
  totalPages: number;
  indexedPages: number;
  limited: boolean;
  suppliedPages: number[];
  suppliedSections: Section[];
  hasBodyText: boolean;
}

export interface Retrieval {
  evidence: Evidence[];
  textChars: number;
  analysis?: AnalysisCoverage;
}

function byScore(index: PaperIndex, scores: number[], boost: (chunk: Chunk) => number = () => 0) {
  return index.chunks.map((chunk, i) => ({
    chunk,
    i,
    score: (scores[i] ?? 0) + boost(chunk) - (chunk.section === "references" ? 4 : 0),
  })).sort((a, b) => b.score - a.score || a.i - b.i);
}

function forAnalysis(index: PaperIndex): Chunk[] {
  const candidates = ANALYSIS_SECTIONS.map(({ query, sections, preferredKinds }) => byScore(
    index, index.rank(query),
    (chunk) => {
      const sameSection = sections.includes(chunk.section);
      const preferred = preferredKinds?.includes(chunk.kind) && (sameSection || chunk.section === "unknown");
      return (sameSection ? 3 : 0) + (preferred ? 4 : 0);
    },
  ).filter(({ chunk, score }) => score > 0 && chunk.kind !== "heading" && chunk.section !== "references"));

  const selected = new Map<string, Chunk>();
  const take = (ranking: (typeof candidates)[number]) => {
    if (selected.size >= ANALYSIS_CHUNKS) return;
    const next = ranking.find(({ chunk }) => !selected.has(chunk.id));
    if (next) selected.set(next.chunk.id, next.chunk);
    return next;
  };
  // Cover every topic before spending the remaining budget on local context.
  const anchors = candidates.map(take);
  for (const hit of anchors) {
    if (!hit) continue;
    const { chunk, i } = hit;
    if (!CONTEXT_SECTIONS.has(chunk.section) && chunk.kind === "paragraph") continue;
    const neighbor = [index.chunks[i - 1], index.chunks[i + 1]].find((candidate) =>
      candidate && !selected.has(candidate.id) && candidate.kind !== "heading" &&
      candidate.section === chunk.section && candidate.heading === chunk.heading &&
      Math.abs(candidate.pageIndex - chunk.pageIndex) <= 1);
    if (neighbor) selected.set(neighbor.id, neighbor);
  }
  for (let pass = 0; pass < 2; pass++) {
    candidates.forEach(take);
  }
  return [...selected.values()];
}

function analysisCoverage(index: PaperIndex, selected: Set<Chunk>, ordered: Chunk[]): AnalysisCoverage {
  const abstractStart = index.chunks.findIndex(({ section }) => section === "abstract");
  // Unknown text preceding a recognized abstract may be title-page metadata.
  const hasBodyText = index.chunks.some((chunk, i) => selected.has(chunk) && chunk.section !== "abstract"
    && (chunk.section !== "unknown" || i > abstractStart));
  return {
    totalPages: index.totalPages,
    indexedPages: index.indexedPages,
    limited: index.limited,
    suppliedPages: [...new Set(ordered.map(({ pageIndex }) => pageIndex + 1))],
    suppliedSections: [...new Set(ordered.map(({ section }) => section))],
    hasBodyText,
  };
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
  const included: Chunk[] = [];
  for (const chunk of chunks) {
    if (chunk.text.length + textChars > budget) continue;
    included.push(chunk);
    textChars += chunk.text.length;
  }
  // Budget in relevance order, then send the chosen analysis excerpts in paper order.
  const selected = mode === "analysis" ? new Set(included) : undefined;
  const ordered = selected ? index.chunks.filter((chunk) => selected.has(chunk)) : included;
  for (const { pageIndex, pageLabel, block, kind, section, heading, text } of ordered) {
    add({ kind: "pdf", location: { pageIndex, pageLabel }, block, blockKind: kind, section, heading, excerpt: text });
  }
  return { evidence, textChars, analysis: selected && analysisCoverage(index, selected, ordered) };
}
