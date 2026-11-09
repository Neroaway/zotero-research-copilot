import { identifySection, normalizeText } from "./text.ts";
import type { Chunk, PdfPage, Section } from "./types.ts";

export const MAX_PDF_PAGES = 300;
const CHUNK_SIZE = 1_050;
const INDEX_LIMIT = 2_000_000;

const STOP = new Set("the a an of and for in with to by it its be as is are from on or at we our this that using used use how what which can about".split(" "));
const ALIASES: Array<[RegExp, string]> = [
  [/方法|网络|模型|架构|模块|流程|特征/u, "method architecture model pipeline module feature"],
  [/问题|目标|动机|挑战/u, "problem motivation challenge objective"],
  [/公式|符号|损失|优化|梯度|训练/u, "equation loss objective optimization gradient training"],
  [/实验|数据集|指标|基线|对比|表现/u, "experiment dataset metric baseline comparison result"],
  [/消融/u, "ablation"],
  [/局限|失败|泛化/u, "limitation failure generalization"],
  [/复现|超参数/u, "implementation hyperparameter reproducibility training"],
  [/图表|图像|图\s*\d+/u, "figure table"],
  [/注视|凝视|视线|眼动/u, "gaze fixation eye tracking"],
  [/扫视|扫描路径/u, "scanpath saccade"],
  [/视觉语言|多模态/u, "vision language vlm multimodal"],
  [/强化学习|奖励|策略/u, "reinforcement learning reward policy"],
];

export function terms(text: string): string[] {
  const lower = text.normalize("NFKC").toLowerCase();
  const words = lower.match(/[a-z0-9]+(?:[-_][a-z0-9]+)*/gu) ?? [];
  const latin = words.flatMap((word) => word.split(/[-_]/u).length > 1 ? [word, ...word.split(/[-_]/u)] : [word]);
  const han = (lower.match(/\p{Script=Han}+/gu) ?? []).flatMap((run) => {
    const chars = [...run];
    return chars.length < 2 ? chars : chars.slice(1).map((char, i) => (chars[i] ?? "") + char);
  });
  const aliases = ALIASES.filter(([pattern]) => pattern.test(lower)).flatMap(([, values]) => values.split(" "));
  return [...latin, ...han, ...aliases]
    .filter((word) => (word.length >= 2 || /^\d$/u.test(word)) && !STOP.has(word))
    .map((word) => word.length > 4 ? word.replace(/(?:s|es)$/u, "") : word);
}

function splitBlock(text: string): string[] {
  const result: string[] = [];
  let remainder = text;
  while (remainder.length > CHUNK_SIZE) {
    const window = remainder.slice(0, CHUNK_SIZE + 1);
    const boundary = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    let end = boundary >= CHUNK_SIZE * 0.7 ? boundary : CHUNK_SIZE;
    // Keep UTF-16 surrogate pairs intact when a long span has no spaces.
    const char = remainder.charCodeAt(end);
    if (char >= 0xdc00 && char <= 0xdfff) end--;
    result.push(remainder.slice(0, end).trim());
    remainder = remainder.slice(end).trimStart();
  }
  if (remainder) result.push(remainder);
  return result;
}

export class PaperIndex {
  readonly chunks: Chunk[];
  readonly totalPages: number;
  readonly indexedPages: number;
  readonly limited: boolean;
  readonly method: "sdt" | "pdf-worker" | "pdf-view" | "none";
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths: number[];
  private readonly averageLength: number;

  constructor(pages: PdfPage[], totalPages: number, method: PaperIndex["method"]) {
    this.totalPages = totalPages;
    this.method = method;
    this.chunks = [];
    this.lengths = [];
    let chars = 0;
    let indexedPages = 0;
    let heading: string | undefined;
    let section: Section = "unknown";
    outer: for (const page of pages) {
      let added = false;
      for (const [blockIndex, source] of page.blocks.entries()) {
        const text = normalizeText(source.text);
        if (!text) continue;
        if (source.kind === "heading") {
          const classified = identifySection(text);
          if (classified !== "unknown") section = classified;
          heading = text.slice(0, 160);
        }
        for (const [part, value] of splitBlock(text).entries()) {
          if (chars + value.length > INDEX_LIMIT) break outer;
          if (!added) {
            indexedPages++;
            added = true;
          }
          chars += value.length;
          const i = this.chunks.length;
          const words = terms([heading, value].filter(Boolean).join(" "));
          this.chunks.push({
            id: `p${page.pageIndex}-b${blockIndex + 1}-${part}`,
            pageIndex: page.pageIndex,
            pageLabel: page.label,
            block: blockIndex + 1,
            section,
            heading,
            kind: source.kind,
            text: value,
          });
          this.lengths.push(words.length);
          for (const word of words) {
            let hits = this.postings.get(word);
            if (!hits) {
              hits = new Map();
              this.postings.set(word, hits);
            }
            hits.set(i, (hits.get(i) ?? 0) + 1);
          }
        }
      }
    }
    this.indexedPages = indexedPages;
    this.limited = pages.length < totalPages || chars > INDEX_LIMIT - CHUNK_SIZE;
    this.averageLength = this.lengths.reduce((sum, count) => sum + count, 0) / this.lengths.length || 1;
  }

  rank(query: string): number[] {
    const scores = Array<number>(this.chunks.length).fill(0);
    const words = new Set(terms(query));
    for (const word of words) {
      const hits = this.postings.get(word);
      if (!hits) continue;
      const idf = Math.log(1 + (this.chunks.length - hits.size + 0.5) / (hits.size + 0.5));
      for (const [index, tf] of hits) {
        const length = this.lengths[index] ?? 0;
        const norm = 1.2 * (0.25 + 0.75 * length / this.averageLength);
        scores[index] = (scores[index] ?? 0) + idf * (tf * 2.2) / (tf + norm);
      }
    }
    return scores;
  }
}
