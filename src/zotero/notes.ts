import { CopilotError } from "../errors.ts";
import type { Evidence } from "../paper/types.ts";
import { branchNodes } from "../research/mind-map.ts";
import type { Turn } from "../research/session.ts";
import { evidenceLabel } from "../ui/evidence.ts";
import { tr } from "../ui/i18n.ts";
import { escapeHTML, renderMarkdown, usedCitations } from "../ui/markdown.ts";
import type { PaperAccess } from "./paper-access.ts";

function pdfLink(evidence: Evidence, annotationExists: (key: string) => boolean): string | undefined {
  const paper = evidence.attachment;
  if (evidence.source.kind === "upload" || !/^[A-Z0-9]{8}$/u.test(paper.attachmentKey)) return;
  const prefix = Zotero.API.getLibraryPrefix(paper.libraryID);
  if (!/^(?:library|groups\/[1-9]\d*)$/u.test(prefix)) return;
  const { pageIndex, annotationKey } = evidence.source.location;
  const annotation = annotationKey && /^[A-Z0-9]{8}$/u.test(annotationKey) && annotationExists(annotationKey)
    ? `&annotation=${annotationKey}` : "";
  return `zotero://open-pdf/${prefix}/items/${paper.attachmentKey}?page=${pageIndex + 1}${annotation}`;
}

export async function saveNote(access: PaperAccess, turn: Turn, mindMap = false): Promise<void> {
  if (turn.phase !== "done" || turn.version === undefined) throw new CopilotError("note-failed");
  if (turn.version !== await access.version()) throw new CopilotError("file-changed");
  const attachment = await access.attachment();
  const parent = attachment.parentItem;
  if (!Zotero.Libraries.isEditable(attachment.libraryID) || parent && !parent.isEditable()) {
    throw new CopilotError("not-editable");
  }

  const t = (en: string, zh: string) => tr(turn.language, en, zh);
  const annotationKeys = new Set(attachment.getAnnotations().map(({ key }) => key));
  const link = (evidence: Evidence) => pdfLink(evidence, (key) => annotationKeys.has(key));
  const render = (text: string) => renderMarkdown(text, turn.evidence, turn.language, link);
  const title = mindMap ? t("Paper mind map", "论文思维导图")
    : turn.mode === "analysis" ? t("Deep paper analysis", "深度解构论文") : t("Paper Q&A", "论文问答");
  let body: string;
  let citedText = turn.text;
  if (mindMap) {
    const branches = turn.branches ?? [];
    citedText = branches.map(({ markdown }) => markdown).join("\n\n");
    body = `<ul>${branches.map((branch) => {
      const nodes = branchNodes(branch.markdown);
      const leaves = nodes.length
        ? `<ul>${nodes.map((node) => `<li>${render(node)}</li>`).join("")}</ul>`
        : `<p><em>${t("Section missing from model output", "模型未生成此节")}</em></p>`;
      return `<li><p><strong>${escapeHTML(branch.title)}</strong></p>${leaves}</li>`;
    }).join("")}</ul>`;
  } else {
    body = render(turn.text);
  }

  const used = usedCitations(citedText);
  const evidenceList = turn.evidence.filter(({ id }) => used.has(id)).map((evidence) => {
    const text = escapeHTML(evidenceLabel(evidence.source, turn.language));
    const href = link(evidence);
    const heading = href ? `<a href="${escapeHTML(href)}">${text}</a>` : text;
    const quote = evidence.source.kind === "pdf"
      ? `<blockquote><p>${escapeHTML(evidence.source.excerpt).replaceAll("\n", "<br>")}</p></blockquote>` : "";
    return `<li><p>${heading}</p>${quote}</li>`;
  });

  const note = new Zotero.Item("note");
  note.libraryID = attachment.libraryID;
  if (parent) note.parentID = parent.id;
  note.addRelatedItem(attachment);
  note.setNote([
    `<h1>${escapeHTML(title)} · ${escapeHTML(access.paper.title)}</h1>`,
    `<p>Zotero Research Copilot · ${escapeHTML(turn.model)} · ${escapeHTML(access.paper.attachmentKey)}</p>`,
    turn.mode === "analysis" ? "" : `<p><strong>${t("Question", "问题")}</strong> ${escapeHTML(turn.question)}</p>`,
    body,
    `<h2>${t("Source excerpts", "原文证据")}</h2>`,
    evidenceList.length ? `<ol>${evidenceList.join("")}</ol>` : `<p>${t("No source markers matched this answer.", "此回答没有匹配到可核验的来源标记。")}</p>`,
  ].join(""));
  try {
    await note.saveTx({ skipSelect: true });
  } catch {
    throw new CopilotError("note-failed");
  }
}
