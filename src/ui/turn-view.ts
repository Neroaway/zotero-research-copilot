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
type Save = (turn: Turn, mindMap: boolean, destination: "zotero" | "obsidian") => Promise<void>;

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderBody(body: HTMLElement, text: string, turn: Turn, language: Language, jump: Jump): boolean {
  try {
    body.innerHTML = renderMarkdown(text, turn.evidence, language);
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
    body.classList.remove("zrc-stream-text");
    return true;
  } catch {
    body.textContent = text;
    body.classList.add("zrc-stream-text");
    return false;
  }
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

function saveButton(doc: Document, text: string, save: () => Promise<void>, className: string) {
  const control = button(doc, text, () => {
    control.disabled = true;
    void save().finally(() => { control.disabled = false; });
  }, `zrc-secondary ${className}`);
  return control;
}

function noteActions(doc: Document, turn: Turn, language: Language, mindMap: boolean, save: Save) {
  const t = (en: string, zh: string) => tr(language, en, zh);
  const actions = html(doc, "div", "zrc-note-actions");
  actions.append(
    saveButton(doc, mindMap ? t("Save map as note", "保存导图为笔记") : t("Save as note", "保存为笔记"),
      () => save(turn, mindMap, "zotero"), "zrc-save"),
    saveButton(doc, t("Save to Obsidian", "保存到 Obsidian"), () => save(turn, mindMap, "obsidian"), "zrc-save-obsidian"),
  );
  return actions;
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
    this.meta = html(doc, "div", "zrc-answer-meta", [turn.model, turn.reasoningEffort].filter(Boolean).join(" · "));
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
        this.status.textContent = turn.text.trim()
          ? t("Generating…", "正在生成…")
          : t("Waiting for the first answer text… The model may still be reasoning.", "等待首段正文…模型可能仍在推理。");
        if (turn.timing) {
          const elapsed = duration(Date.now() - turn.timing.startedAt);
          const limit = turn.timing.timeoutMs === undefined ? undefined : duration(turn.timing.timeoutMs);
          this.status.textContent += limit
            ? t(` Elapsed ${elapsed} / limit ${limit}.`, ` 已用 ${elapsed} / 最长 ${limit}。`)
            : t(` Elapsed ${elapsed} · no local time limit.`, ` 已用 ${elapsed} · 不设本地时限。`);
        }
        return;
      case "failed":
        if (turn.error?.code === "timeout" && turn.timing?.timeoutMs !== undefined) {
          const minutes = turn.timing.timeoutMs / 60_000;
          this.status.textContent = t(
            `The request timed out at its ${minutes}-minute waiting limit. Adjust Answer maximum wait in Settings and retry.`,
            `已达到本次 ${minutes} 分钟的等待上限。可在设置中调整「回答最长等待」后重试。`,
          );
        } else this.status.textContent = errorMessage(turn.error, this.language);
        break;
      case "stopped": {
        const reason = turn.stopReason;
        this.status.textContent = reason === "user" ? t("Stopped by you.", "已手动停止。")
          : reason === "reader-closed" || reason === "reader-unloaded"
            ? t("Interrupted because the PDF reader closed or was unloaded.", "阅读器关闭或被卸载，任务已中断。")
            : reason === "plugin-unloaded" ? t("Interrupted because the plugin shut down or reloaded.", "插件关闭或重新加载，任务已中断。")
              : reason === "external" ? t("The request was cancelled by the environment.", "请求被运行环境取消。")
                : reason === "restored" ? t("The previous request was interrupted before completion.", "上次请求尚未完成就被中断。")
                  : t("This earlier request was interrupted; the older version did not record the cause.", "这次历史请求已中断；旧版本未记录具体原因。");
        this.status.textContent += t(" Partial text is excluded from history and notes.", "未完成的内容不会进入后续对话或笔记。");
        break;
      }
      case "done": {
        const formatted = renderBody(this.body, turn.text, turn, this.language, jump);
        this.status.hidden = formatted;
        this.status.textContent = formatted ? "" : t(
          "Answer completed. Displaying plain text because formatting failed.",
          "回答已完成。格式渲染失败，已保留纯文本。",
        );
        const missing = turn.branches?.filter(({ missing }) => missing).length ?? 0;
        if (missing) {
          this.element.append(html(doc, "p", "zrc-footnote", t(
            `The model omitted ${missing} requested section(s). These are marked in the mind map.`,
            `模型缺少 ${missing} 个要求的章节，已在思维导图中标出。`,
          )));
        }
        this.element.append(sourcesFor(doc, turn, this.language, jump));
        this.element.append(noteActions(doc, turn, this.language, false, save));
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
    const reasoning = usage?.reasoningTokens?.toLocaleString();
    const reasoningLabel = reasoning ? t(`of which reasoning ${reasoning}`, `其中推理 ${reasoning}`) : "";
    const elapsed = turn.timing?.finishedAt === undefined ? ""
      : t(`Elapsed ${duration(turn.timing.finishedAt - turn.timing.startedAt)}`, `耗时 ${duration(turn.timing.finishedAt - turn.timing.startedAt)}`);
    this.meta.textContent = [turn.model, turn.reasoningEffort, tokens, reasoningLabel, elapsed].filter(Boolean).join("  ·  ");
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
    if (turn.timing) {
      const minutes = turn.timing.timeoutMs === undefined ? undefined : turn.timing.timeoutMs / 60_000;
      const budget = turn.timing.maxOutputTokens?.toLocaleString();
      this.element.append(html(doc, "p", "zrc-footnote", [
        minutes === undefined ? t("No local time limit", "不设本地等待时限") : t(`Waiting limit ${minutes} min`, `等待上限 ${minutes} 分钟`),
        turn.contextChars ? budget ? t(`Output budget ${budget} tokens`, `输出预算 ${budget} tokens`)
          : t("Output budget set by API", "输出预算由 API 决定") : "",
      ].filter(Boolean).join(" · ")));
    }
  }
}

export function mindMapView(doc: Document, title: string, turn: Turn, language: Language, jump: Jump, save: Save) {
  const t = (en: string, zh: string) => tr(language, en, zh);
  const map = html(doc, "div", "zrc-map");
  const header = html(doc, "div", "zrc-map-header");
  header.append(
    html(doc, "span", "zrc-eyebrow", t("Paper mind map", "论文思维导图")),
    noteActions(doc, turn, language, true, save),
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
