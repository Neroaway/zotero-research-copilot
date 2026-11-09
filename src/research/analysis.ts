import type { Evidence } from "../paper/types.ts";
import { ANALYSIS_SECTIONS } from "./sections.ts";

const CITATION = /\[\[(E[1-9]\d{0,3})\]\]/gu;

export interface AnalysisBranch {
  title: string;
  markdown: string;
  missing: boolean;
}

export function parseAnalysis(markdown: string): AnalysisBranch[] {
  const sections = new Map<string, string[]>();
  let active: string[] | undefined;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/u)) {
    const edge = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (edge && (!fence || edge[0] === fence[0] && edge.length >= fence.length)) {
      fence = fence ? undefined : edge;
    }
    if (!fence && !edge) {
      const heading = /^ {0,3}#{1,6}\s+(?:\d+[.)]\s+)?(.+?)\s*#*$/u.exec(line)?.[1]?.replace(/\*\*/gu, "").trim();
      if (heading) {
        const section = ANALYSIS_SECTIONS.find(({ title }) => heading.toLowerCase() === title.toLowerCase());
        if (section) {
          active = [];
          sections.set(section.title, active);
          continue;
        }
      }
    }
    active?.push(line);
  }
  return ANALYSIS_SECTIONS.map(({ title }) => {
    const text = sections.get(title)?.join("\n").trim() ?? "";
    return { title, markdown: text, missing: !text };
  });
}

export function citedIDs(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION)].map((match) => match[1] ?? ""))];
}

export function removeCitations(text: string): string {
  return text.replace(CITATION, "");
}

export function verifyEvidenceLabels(text: string, evidence: Evidence[]): string {
  const kinds = new Map(evidence.map(({ id, source }) => [id, source.kind]));
  // Require each explicit evidence label to be followed by a matching source
  // within that bullet/paragraph. Keep inferred claims visible when it is absent.
  let fence: string | undefined;
  let block: string[] = [];
  const output: string[] = [];
  const flush = () => {
    const value = block.join("\n");
    const ids = citedIDs(value.replace(/(`+)[^\n]*?\1/gu, ""));
    let checked = value;
    if (!ids.some((id) => kinds.get(id) === "pdf")) {
      checked = checked.replaceAll("[Paper evidence]", "[Unsupported claim]");
    }
    if (!ids.some((id) => kinds.get(id) === "page-image" || kinds.get(id) === "upload")) {
      checked = checked.replaceAll("[Visual observation]", "[Unsupported claim]");
    }
    if (!ids.some((id) => kinds.get(id) === "pdf" || kinds.get(id) === "page-image")) {
      checked = checked.replaceAll("[Research proposal]", "[Unanchored proposal]");
    }
    output.push(checked);
    block = [];
  };
  for (const line of text.split(/\r?\n/u)) {
    const edge = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (edge && (!fence || edge[0] === fence[0] && edge.length >= fence.length)) {
      if (block.length) flush();
      fence = fence ? undefined : edge;
      output.push(line);
      continue;
    }
    if (fence) {
      output.push(line);
      continue;
    }
    if (!line.trim() || /^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|\|)/u.test(line)) {
      if (block.length) flush();
    }
    block.push(line);
  }
  if (block.length) flush();
  return output.join("\n");
}
