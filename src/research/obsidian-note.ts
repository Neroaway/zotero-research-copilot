import type { Evidence } from "../paper/types.ts";
import { analysisCoverageLabel, evidenceLabel } from "../ui/evidence.ts";
import { tr } from "../ui/i18n.ts";
import { mapMarkdownProse } from "../ui/markdown.ts";
import type { Turn } from "./session.ts";

function safeProse(text: string): string {
  return text.replace(/<(?=[A-Za-z!/?])/gu, "&lt;").replaceAll("![", "&#33;[");
}

export function buildObsidianNote(
  paperTitle: string,
  turn: Turn,
  mindMap: boolean,
  link: (evidence: Evidence) => string | undefined,
): string {
  const t = (en: string, zh: string) => tr(turn.language, en, zh);
  const title = paperTitle.replace(/\s+/gu, " ").trim();
  const kind = mindMap ? t("Mind map", "思维导图")
    : turn.mode === "analysis" ? t("Deep analysis", "深度解构") : t("Paper Q&A", "论文问答");
  const markdown = mindMap ? (turn.branches ?? []).map(({ title, markdown }) =>
    `## ${title}\n\n${markdown || t("Section missing from model output.", "模型未生成此节。")}`).join("\n\n") : turn.text;
  const evidence = new Map(turn.evidence.map((entry) => [entry.id, entry]));
  const cited = new Set<Evidence>();
  const citation = (entry: Evidence, compact: boolean) => {
    const label = safeProse(evidenceLabel(entry.source, turn.language, compact))
      .replaceAll("[", "\\[").replaceAll("]", "\\]");
    const href = link(entry);
    return href ? `[${label}](${href})` : label;
  };
  const body = mapMarkdownProse(markdown, (prose) => safeProse(prose).replace(
    /(?<!\\)\[\[(E[1-9]\d{0,3})\]\]/gu, (_match, id: string) => {
      const entry = evidence.get(id);
      if (!entry) return t("[Unverified source]", "[来源未核实]");
      cited.add(entry);
      return citation(entry, true);
    },
  ));
  const sources = [...cited].map((entry) => {
    const heading = `### ${citation(entry, false)}`;
    const { source } = entry;
    return source.kind === "pdf"
      ? `${heading}\n\n${safeProse(source.excerpt).split("\n").map((line) => `> ${line}`).join("\n")}`
      : heading;
  });
  const model = [turn.model, turn.reasoningEffort].filter(Boolean).join(" · ");
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `model: ${JSON.stringify(turn.model)}`,
    ...(turn.reasoningEffort ? [`reasoning_effort: ${JSON.stringify(turn.reasoningEffort)}`] : []),
    "tags: [research-copilot]",
    "---",
    "",
    `# ${safeProse(title)} · ${kind}`,
    "",
    `Zotero Research Copilot · ${model}`,
    ...(turn.analysisCoverage ? ["", analysisCoverageLabel(turn.analysisCoverage, turn.language)] : []),
    ...(turn.mode === "analysis" ? [] : ["", `**${t("Question", "问题")}** ${safeProse(turn.question)}`]),
    "",
    body,
    ...(sources.length ? ["", `## ${t("Source excerpts", "原文证据")}`, "", sources.join("\n\n")] : []),
    "",
  ].join("\n");
}
