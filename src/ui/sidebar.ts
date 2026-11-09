import type { AIProvider } from "../ai/provider.ts";
import { CopilotError } from "../errors.ts";
import { QUESTION_LIMIT } from "../paper/retrieve.ts";
import type { Evidence, Selection, VisualInput } from "../paper/types.ts";
import { ResearchSession } from "../research/session.ts";
import type { Task, Turn } from "../research/session.ts";
import { resolveLanguage } from "../storage/settings.ts";
import type { Language, Settings } from "../storage/settings.ts";
import { saveNote } from "../zotero/notes.ts";
import type { PaperAccess, PaperVersion } from "../zotero/paper-access.ts";
import { renderPdfPage } from "../zotero/pdf-view.ts";
import type { Reader } from "../zotero/reader-host.ts";
import { button, html } from "./dom.ts";
import { tr } from "./i18n.ts";
import { prepareUpload } from "./image-input.ts";
import { errorMessage } from "./messages.ts";
import { mindMapView, TurnView } from "./turn-view.ts";

interface SidebarOptions {
  doc: Document;
  reader: Reader;
  access: PaperAccess;
  settings: Settings;
  provider: AIProvider;
  locale: string;
  openPreferences: () => void;
  onVisibilityChange: (open: boolean) => void;
}

interface PendingVisual {
  input: VisualInput;
  version?: PaperVersion;
}

export class Sidebar {
  readonly root: HTMLElement;
  private readonly options: SidebarOptions;
  private readonly session = new ResearchSession();
  private readonly language: Language;
  private readonly list: HTMLElement;
  private readonly composer: HTMLElement;
  private readonly map: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly editor: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly stopWatchingModel: () => void;
  private readonly send: HTMLButtonElement;
  private readonly stop: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly analyze: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly chatTab: HTMLButtonElement;
  private readonly mapTab: HTMLButtonElement;
  private readonly preview: HTMLElement;
  private readonly cards = new Map<Turn, TurnView>();
  private pendingVisual?: PendingVisual;
  private preparingImage = false;
  private mapTurn?: Turn;
  private frame?: number;
  private disposed = false;

  constructor(options: SidebarOptions) {
    this.options = options;
    const { doc, settings, locale, access } = options;
    this.language = resolveLanguage(settings.language, locale);
    const t = this.t;

    this.root = html(doc, "aside", "zrc-panel");
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Zotero Research Copilot");

    const head = html(doc, "header", "zrc-header");
    const top = html(doc, "div", "zrc-top");
    const brand = html(doc, "div", "zrc-brand");
    const icon = html(doc, "img");
    icon.src = "chrome://zrc-copilot/content/icon.svg";
    icon.alt = "";
    brand.append(icon, html(doc, "span", "", "Research Copilot"));
    const actions = html(doc, "div", "zrc-top-actions");
    actions.append(
      button(doc, t("Settings", "设置"), options.openPreferences, "zrc-quiet zrc-settings-button"),
      button(doc, "×", () => this.setOpen(false), "zrc-quiet zrc-close"),
    );
    actions.lastElementChild?.setAttribute("aria-label", t("Close sidebar", "关闭侧栏"));
    top.append(brand, actions);
    const title = html(doc, "h2", "zrc-title", access.paper.title);
    title.title = access.paper.title;
    const actionRow = html(doc, "div", "zrc-header-action");
    const modelValue = html(doc, "span", "zrc-model-value");
    const modelButton = button(doc, t("Change model", "切换模型"), options.openPreferences, "zrc-secondary zrc-model-button");
    modelButton.append(modelValue);
    this.stopWatchingModel = settings.watchModel((id) => {
      modelValue.textContent = id;
      modelButton.title = t(`Change model · current model ${id}`, `切换模型 · 当前模型 ${id}`);
    });
    this.analyze = button(doc, t("Deep analysis", "深度解构论文"), () => {
      void this.run(this.withImage({ mode: "analysis", question: t("Deeply analyze this paper", "深度解构当前论文") }));
    }, "zrc-primary zrc-analyze");
    actionRow.append(this.analyze, modelButton);
    head.append(top, title, actionRow);

    const tabs = html(doc, "nav", "zrc-tabs");
    tabs.setAttribute("aria-label", t("Copilot view", "Copilot 视图"));
    this.chatTab = button(doc, t("Chat", "论文对话"), () => this.setView(false));
    this.mapTab = button(doc, t("Mind map", "思维导图"), () => this.setView(true), "zrc-map-tab");
    tabs.append(this.chatTab, this.mapTab);

    this.list = html(doc, "section", "zrc-chat");
    this.list.setAttribute("aria-label", t("Conversation", "对话记录"));
    this.empty = html(doc, "div", "zrc-empty");
    this.empty.append(
      html(doc, "span", "zrc-eyebrow", t("CURRENT PDF", "当前论文")),
      html(doc, "h3", "", t("Read with the source in view", "带着原文读论文")),
      html(doc, "p", "", t(
        "Ask about the method, select a formula in the PDF, or run a deep analysis to build a mind map.",
        "可以追问方法、选中公式精读，或深度解构整篇论文并生成思维导图。",
      )),
    );
    this.list.append(this.empty);

    this.map = html(doc, "section", "zrc-map-panel");
    this.map.append(html(doc, "div", "zrc-empty", t("Run Deep analysis to populate the map.", "完成深度解构后，导图会在这里展开。")));

    this.composer = html(doc, "div", "zrc-composer");
    this.editor = html(doc, "textarea", "zrc-editor");
    this.editor.placeholder = t("Ask about this paper…", "提问当前论文…");
    this.editor.setAttribute("aria-label", this.editor.placeholder);
    this.editor.maxLength = QUESTION_LIMIT;
    this.editor.rows = 3;
    this.editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        this.submit();
      }
    });

    const toolbar = html(doc, "div", "zrc-composer-actions");
    this.clear = button(doc, t("Clear chat", "清空对话"), () => {
      this.session.clear();
      this.mapTurn = undefined;
      this.map.replaceChildren(html(doc, "div", "zrc-empty", t("Run Deep analysis to populate the map.", "完成深度解构后，导图会在这里展开。")));
      this.setView(false);
      this.update();
    }, "zrc-quiet");
    this.retry = button(doc, t("Retry", "重试"), () => void this.run(), "zrc-secondary");
    this.stop = button(doc, t("Stop", "停止"), () => this.session.stop(), "zrc-secondary zrc-stop");
    this.send = button(doc, t("Send", "发送"), () => this.submit(), "zrc-primary zrc-send");
    toolbar.append(this.clear, this.retry, this.stop, this.send);
    this.status = html(doc, "p", "zrc-panel-status");
    this.status.setAttribute("role", "status");
    this.preview = html(doc, "div", "zrc-image-preview");
    this.preview.hidden = true;
    this.composer.append(this.imageControls(), this.preview, this.editor, toolbar);
    this.root.append(head, tabs, this.list, this.map, this.composer, this.status);
    this.setView(false);
    this.update();
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    this.options.onVisibilityChange(open);
    if (open) this.update();
  }

  explain(selection: Selection): void {
    this.setOpen(true);
    void this.run({
      mode: "selection",
      question: this.t("Explain this selection", "精读所选文本或公式"),
      selection,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatchingModel();
    this.session.dispose();
    this.pendingVisual = undefined;
    const win = this.options.doc.defaultView;
    if (this.frame !== undefined) win?.cancelAnimationFrame(this.frame);
  }

  private readonly t = (en: string, zh: string) => tr(this.language, en, zh);

  private setView(map: boolean): void {
    this.list.hidden = map;
    this.composer.hidden = map;
    this.map.hidden = !map;
    this.chatTab.setAttribute("aria-pressed", String(!map));
    this.mapTab.setAttribute("aria-pressed", String(map));
  }

  private submit(): void {
    const question = this.editor.value.trim();
    if (this.session.busy || this.preparingImage) return;
    if (!question) {
      this.status.textContent = errorMessage(new CopilotError("empty-input"), this.language);
      this.editor.focus();
      return;
    }
    this.editor.value = "";
    void this.run(this.withImage({ mode: "question", question }));
  }

  private withImage(task: Task): Task {
    const visual = this.pendingVisual;
    this.pendingVisual = undefined;
    this.refreshPreview();
    return { ...task, visual: visual?.input, visualVersion: visual?.version };
  }

  private async run(task?: Task): Promise<void> {
    if (this.session.busy || this.preparingImage || this.disposed) return;
    this.status.textContent = "";
    this.setView(false);
    const { doc, access, settings, provider, locale } = this.options;
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (!win) return;
    try {
      await this.session.run({
        provider, settings, source: access, task,
        language: resolveLanguage(settings.language, locale),
        controller: new win.AbortController(),
        onChange: () => this.scheduleUpdate(),
      });
    } catch (error) {
      this.status.textContent = errorMessage(error, this.language);
    }
  }

  private scheduleUpdate(): void {
    if (this.frame !== undefined || this.disposed) return;
    this.frame = this.options.doc.defaultView?.requestAnimationFrame(() => {
      this.frame = undefined;
      this.update();
    });
  }

  private update(): void {
    const { turns, busy, canRetry } = this.session;
    const shouldScroll = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 80;
    const { doc, access } = this.options;
    this.empty.hidden = turns.length > 0;
    this.send.disabled = this.analyze.disabled = busy || this.preparingImage;
    this.stop.hidden = !busy;
    this.retry.hidden = !canRetry || busy;
    this.clear.disabled = busy || !turns.length;
    this.root.setAttribute("aria-busy", String(busy));
    for (const [turn, card] of this.cards) {
      if (!turns.includes(turn)) {
        card.element.remove();
        this.cards.delete(turn);
      }
    }
    for (const turn of turns) {
      let card = this.cards.get(turn);
      if (!card) {
        card = new TurnView(doc, turn, this.language);
        this.cards.set(turn, card);
        this.list.append(card.element);
      }
      card.update(turn, this.jump, this.save);
    }
    const latest = turns.findLast((turn) => turn.phase === "done" && turn.branches);
    if (latest && latest !== this.mapTurn) {
      this.mapTurn = latest;
      this.map.replaceChildren(mindMapView(doc, access.paper.title, latest, this.language, this.jump, this.save));
      this.mapTab.classList.add("zrc-map-ready");
    } else if (!this.mapTurn) {
      this.mapTab.classList.remove("zrc-map-ready");
    }
    if (shouldScroll) this.list.scrollTop = this.list.scrollHeight;
  }

  private readonly jump = (turn: Turn, evidence: Evidence) => {
    if (evidence.source.kind === "upload" || turn.version === undefined
      || evidence.attachment.itemID !== this.options.access.paper.itemID) return;
    void this.options.access.navigate(evidence.source.location, turn.version).catch((error: unknown) => {
      this.status.textContent = errorMessage(error, this.language);
    });
  };

  private readonly save = async (turn: Turn, map: boolean) => {
    this.status.textContent = "";
    try {
      await saveNote(this.options.access, turn, map);
      this.status.textContent = this.t("Saved a new Zotero note.", "已新建 Zotero 笔记。");
    } catch (error) {
      this.status.textContent = errorMessage(error, this.language);
    }
  };

  private imageControls(): HTMLElement {
    const { doc, reader, access } = this.options;
    const t = this.t;
    const details = html(doc, "details", "zrc-image-controls");
    details.append(html(doc, "summary", "", t("Add a figure or page", "添加图表或页面")));
    const controls = html(doc, "div", "zrc-image-actions");
    const page = html(doc, "input");
    page.type = "number";
    page.min = "1";
    page.placeholder = t("PDF page", "PDF 页码");
    page.setAttribute("aria-label", t("Physical PDF page number", "PDF 物理页码"));
    const capture = button(doc, t("Attach page", "附加页面"), () => {
      void this.setVisual(async () => {
        const index = page.valueAsNumber - 1;
        if (!Number.isSafeInteger(index) || index < 0) throw new CopilotError("invalid-page");
        const version = await access.version();
        const input = await renderPdfPage(reader, index);
        if (version !== await access.version()) throw new CopilotError("file-changed");
        return { input, version };
      });
    }, "zrc-secondary");
    const upload = html(doc, "input", "zrc-upload");
    upload.type = "file";
    upload.accept = "image/png,image/jpeg,image/webp";
    upload.setAttribute("aria-label", t("Attach a local image", "附加本地图像"));
    upload.addEventListener("change", () => {
      const file = upload.files?.[0];
      upload.value = "";
      if (file) void this.setVisual(async () => ({ input: await prepareUpload(file, doc) }));
    });
    controls.append(page, capture, upload);
    details.append(controls);
    return details;
  }

  private async setVisual(make: () => Promise<PendingVisual>): Promise<void> {
    if (this.preparingImage || this.session.busy) return;
    this.preparingImage = true;
    this.status.textContent = this.t("Preparing image…", "正在准备图像…");
    this.update();
    try {
      const visual = await make();
      if (this.disposed) return;
      this.pendingVisual = visual;
      this.refreshPreview();
      this.status.textContent = "";
    } catch (error) {
      this.status.textContent = errorMessage(error, this.language);
    } finally {
      this.preparingImage = false;
      if (!this.disposed) this.update();
    }
  }

  private refreshPreview(): void {
    const { doc } = this.options;
    this.preview.replaceChildren();
    const visual = this.pendingVisual?.input;
    this.preview.hidden = !visual;
    if (!visual) return;
    const label = visual.kind === "page"
      ? this.t(`PDF page ${visual.location.pageIndex + 1}`, `PDF 第 ${visual.location.pageIndex + 1} 页`)
      : this.t("Local image", "本地图像");
    const image = html(doc, "img");
    image.src = visual.dataURL;
    image.alt = label;
    this.preview.append(image, html(doc, "span", "", label), button(doc, this.t("Remove", "移除"), () => {
      this.pendingVisual = undefined;
      this.refreshPreview();
    }, "zrc-quiet"));
  }
}
