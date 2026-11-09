import type { Evidence } from "../paper/types.ts";
import { branchNodes } from "../research/mind-map.ts";
import type { Turn } from "../research/session.ts";
import type { Language } from "../storage/settings.ts";
import { button, html } from "./dom.ts";
import { analysisCoverageLabel, evidenceLabel } from "./evidence.ts";
import { tr } from "./i18n.ts";
import { renderMarkdown, usedCitations } from "./markdown.ts";
import { errorMessage } from "./messages.ts";

type Jump = (turn: Turn, evidence: Evidence) => void;
type Save = (turn: Turn, mindMap: boolean) => Promise<void>;

function renderBody(body: HTMLElement, text: string, turn: Turn, language: Language, jump: Jump) {
  body.innerHTML = renderMarkdown(text, turn.evidence, language);
  // Gecko sanitizes form controls from HTML assigned in privileged documents.
  // Build citation controls with DOM methods from the locally resolved IDs.
  body.querySelectorAll<HTMLElement>(".zrc-cite-slot").forEach((slot) => {
    const evidence = turn.evidence.find(({ id }) => id === slot.textContent);
    if (!evidence) return;
    const label = evidenceLabel(evidence.source, language, true);
    const control = button(body.ownerDocument, label, () => jump(turn, evidence), "zrc-inline-cite");
    control.title = evidenceLabel(evidence.source, language);
    control.disabled = evidence.source.kind === "upload";
    slot.replaceWith(control);
  });
}

function sourcesFor(doc: Document, turn: Turn, language: Language, jump: Jump): HTMLElement {
  const t = (en: string, zh: string) => tr(language, en, zh);
  const used = usedCitations(turn.text);
  const sources = turn.evidence.filter(({ id }) => used.has(id));
  if (!sources.length) {
    return html(doc, "p", "zrc-footnote", t("No citation in the answer matched a supplied source.", "此回答未匹配到可核验的来源。"));
  }
  const container = html(doc, "details", "zrc-sources");
  container.append(html(doc, "summary", "", t(`Inspect evidence (${sources.length})`, `核对原文证据（${sources.length}）`)));
  for (const evidence of sources) {
    const { source } = evidence;
    const row = html(doc, "div", "zrc-source");
    const label = evidenceLabel(source, language);
    if (source.kind === "upload") row.append(html(doc, "b", "", label));
    else row.append(button(doc, label, () => jump(turn, evidence), "zrc-source-link"));
    if (source.kind === "pdf") {
      if (source.heading) row.append(html(doc, "div", "zrc-source-heading", source.heading));
      row.append(html(doc, "blockquote", "", source.excerpt));
    }
    container.append(row);
  }
  return container;
}

function saveButton(doc: Document, text: string, save: () => Promise<void>) {
  const control = button(doc, text, () => {
    control.disabled = true;
    void save().finally(() => { control.disabled = false; });
  }, "zrc-secondary zrc-save");
  return control;
}

export class TurnView {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly language: Language;
  private final = false;

  constructor(doc: Document, turn: Turn, language: Language) {
    this.language = language;
    this.element = html(doc, "article", "zrc-turn");
    const t = (en: string, zh: string) => tr(language, en, zh);
    const kind = turn.mode === "analysis" ? t("Deep analysis", "深度解构")
      : turn.mode === "selection" ? t("Selection", "选区精读") : t("Question", "提问");
    const question = html(doc, "div", "zrc-question");
    question.append(html(doc, "span", "zrc-eyebrow", kind), html(doc, "p", "", turn.question));
    const answer = html(doc, "div", "zrc-answer");
    this.meta = html(doc, "div", "zrc-answer-meta", turn.model);
    this.status = html(doc, "p", "zrc-turn-status");
    this.body = html(doc, "div", "zrc-answer-body");
    answer.append(this.meta, this.body, this.status);
    this.element.append(question, answer);
  }

  update(turn: Turn, jump: Jump, save: Save): void {
    if (this.final) return;
    const doc = this.element.ownerDocument;
    const t = (en: string, zh: string) => tr(this.language, en, zh);
    this.body.textContent = turn.text;
    this.body.classList.add("zrc-stream-text");
    switch (turn.phase) {
      case "credentials":
        this.status.textContent = t("Checking credentials…", "正在读取凭证…");
        return;
      case "indexing":
        this.status.textContent = t("Indexing this PDF…", "正在索引当前 PDF…") + (turn.progress === undefined ? "" : ` ${turn.progress}%`);
        return;
      case "streaming":
        this.status.textContent = t("Generating…", "正在生成…");
        return;
      case "failed":
        this.status.textContent = errorMessage(turn.error, this.language);
        break;
      case "stopped":
        this.status.textContent = t("Stopped. Partial text is excluded from history and notes.", "已停止。未完成的内容不会进入后续对话或笔记。");
        break;
      case "done": {
        this.body.classList.remove("zrc-stream-text");
        renderBody(this.body, turn.text, turn, this.language, jump);
        this.status.hidden = true;
        const missing = turn.branches?.filter(({ missing }) => missing).length ?? 0;
        if (missing) {
          this.element.append(html(doc, "p", "zrc-footnote", t(
            `The model omitted ${missing} requested section(s). These are marked in the mind map.`,
            `模型缺少 ${missing} 个要求的章节，已在思维导图中标出。`,
          )));
        }
        this.element.append(sourcesFor(doc, turn, this.language, jump));
        this.element.append(saveButton(doc, t("Save as note", "保存为笔记"), () => save(turn, false)));
        break;
      }
    }
    this.final = true;
    if (turn.phase !== "done") this.element.classList.add("zrc-turn-interrupted");
    const usage = turn.usage;
    const tokens = usage
      ? t(`In ${usage.inputTokens.toLocaleString()} · Out ${usage.outputTokens.toLocaleString()}`,
        `输入 ${usage.inputTokens.toLocaleString()} · 输出 ${usage.outputTokens.toLocaleString()}`)
      : "";
    this.meta.textContent = [turn.model, tokens].filter(Boolean).join("  ·  ");
    if (usage?.cachedTokens) this.meta.title = t(`Cached input tokens ${usage.cachedTokens}`, `缓存输入 token ${usage.cachedTokens}`);
    if (turn.index) {
      const { indexedPages, totalPages, limited } = turn.index;
      const coverage = totalPages ? t(`${indexedPages}/${totalPages} pages with text`, `${indexedPages}/${totalPages} 页有文本`) : "";
      const supplied = turn.analysisCoverage && analysisCoverageLabel(turn.analysisCoverage, this.language);
      const count = t(`${turn.contextChars.toLocaleString()} PDF characters sent`, `发送 ${turn.contextChars.toLocaleString()} 个 PDF 字符`);
      if (turn.evidence.length) {
        this.element.append(html(doc, "p", "zrc-footnote",
          [coverage, supplied, count, limited ? t("index limit reached", "达到索引上限") : ""].filter(Boolean).join(" · ")));
      }
    }
  }
}

export function mindMapView(doc: Document, title: string, turn: Turn, language: Language, jump: Jump, save: Save) {
  const t = (en: string, zh: string) => tr(language, en, zh);
  const map = html(doc, "div", "zrc-map");
  const header = html(doc, "div", "zrc-map-header");
  header.append(
    html(doc, "span", "zrc-eyebrow", t("Paper mind map", "论文思维导图")),
    saveButton(doc, t("Save as note", "保存导图为笔记"), () => save(turn, true)),
  );
  map.append(header, html(doc, "div", "zrc-map-root", title));
  const tree = html(doc, "div", "zrc-map-tree");
  for (const [i, branch] of (turn.branches ?? []).entries()) {
    const detail = html(doc, "details", "zrc-branch");
    const summary = html(doc, "summary", "");
    summary.append(html(doc, "span", "zrc-branch-index", String(i + 1)), html(doc, "span", "", branch.title));
    detail.append(summary);
    detail.open = i === 0;
    const leaves = html(doc, "div", "zrc-map-leaves");
    if (branch.missing) {
      leaves.append(html(doc, "p", "zrc-footnote", t("Section missing from the model output.", "模型未生成此节。")));
    } else {
      for (const node of branchNodes(branch.markdown)) {
        const leaf = html(doc, "article", "zrc-map-leaf zrc-answer-body");
        renderBody(leaf, node, turn, language, jump);
        leaves.append(leaf);
      }
    }
    detail.append(leaves);
    tree.append(detail);
  }
  map.append(tree);
  return map;
}
