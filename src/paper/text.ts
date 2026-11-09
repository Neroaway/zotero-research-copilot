import type { BlockKind, PdfPage, Section, TextBlock } from "./types.ts";

const SECTIONS: ReadonlyArray<[Section, RegExp]> = [
  ["abstract", /^(?:abstract|摘要)\b|^摘要/iu],
  ["intro", /^(?:introduction|background|motivation)\b|^(?:引言|介绍|背景)/iu],
  ["related", /^(?:related work|prior work|literature review)\b|^相关工作/iu],
  ["ablation", /^(?:ablation|component analysis|sensitivity analysis)\b|^消融/iu],
  ["limitations", /^(?:limitations?|failure cases?|broader impact|discussion)\b|^(?:局限|讨论)/iu],
  ["experiments", /^(?:experiments?|experimental|evaluation|implementation details?|datasets?|benchmarks?|training details?)\b|^实验/iu],
  ["results", /^(?:results?|comparison|quantitative|qualitative|main results)\b|^结果/iu],
  ["method", /^(?:methodology|methods?|approach|proposed|framework|architecture|model|algorithm|loss|formulation)\b|^(?:方法|模型|算法)/iu],
  ["conclusion", /^(?:conclusions?|future work)\b|^(?:结论|总结)/iu],
  ["references", /^(?:references|bibliography|works cited)\b|^参考文献/iu],
];

export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex -- Strip non-text PDF controls but preserve line breaks.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[\t\u00A0 ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function identifySection(text: string): Section {
  const title = text.replace(/^\s*(?:(?:\d+(?:\.\d+)*[.):]?|[IVX]+[.)]|[A-Z][.)])\s+)/u, "");
  return SECTIONS.find(([, pattern]) => pattern.test(title))?.[0] ?? "unknown";
}

export function paragraphBlocks(text: string): TextBlock[] {
  const result: TextBlock[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const value = normalizeText(line);
    if (!value) continue;
    const abstract = /^(Abstract|摘要)\s*[:—–-]\s*(.+)$/iu.exec(value);
    if (abstract?.[1] && abstract[2]) {
      result.push({ kind: "heading", text: abstract[1] }, { kind: "paragraph", text: abstract[2] });
      continue;
    }
    const heading = value.length <= 96 && identifySection(value) !== "unknown" && !/[.!?。]$/u.test(value);
    result.push({ kind: heading ? "heading" : "paragraph", text: value });
  }
  return result;
}

export interface SdtNode {
  type?: string;
  text?: string;
  content?: SdtNode[];
  anchor?: { pageRects?: number[][] };
}

export interface SdtDocument {
  schemaVersion: string;
  catalog: { pages: { label?: string }[] };
  content: SdtNode[];
}

function nodeText(node: SdtNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "linebreak" || node.type === "break") return "\n";
  return Array.isArray(node.content) ? node.content.map(nodeText).join("") : "";
}

function blockKind(type: string | undefined): BlockKind {
  if (type === "heading" || type === "math" || type === "caption" || type === "table") return type;
  return "paragraph";
}

export function pagesFromSdt(document: SdtDocument, limit: number): PdfPage[] {
  if (!/^1\./u.test(document.schemaVersion) || !Array.isArray(document.catalog?.pages)
    || !Array.isArray(document.content)) return [];
  const pages: PdfPage[] = document.catalog.pages.slice(0, limit).map(({ label }, pageIndex) => ({
    pageIndex,
    label: typeof label === "string" ? label.slice(0, 64) : undefined,
    blocks: [],
  }));
  const add = (node: SdtNode) => {
    if (node.type === "list" && Array.isArray(node.content)) {
      node.content.forEach(add);
      return;
    }
    const rects = node.anchor?.pageRects;
    const pageIndex = rects?.[0]?.[0];
    // A multi-page block must not become a single-page quotation.
    if (pageIndex === undefined || !Number.isInteger(pageIndex) || !rects?.every((rect) => rect[0] === pageIndex)) return;
    const page = pages[pageIndex];
    if (!page) return;
    const text = normalizeText(nodeText(node));
    if (text) page.blocks.push({ kind: blockKind(node.type), text });
  };
  document.content.forEach(add);
  return pages;
}

/** Zotero's native worker separates pages with FF, but trims empty outer pages. */
export function pagesFromFullText(text: string, extractedPages: number): PdfPage[] {
  const parts = text.split("\f");
  if (parts.length !== extractedPages) return [];
  return parts.map((part, pageIndex) => ({ pageIndex, blocks: paragraphBlocks(part) }));
}
