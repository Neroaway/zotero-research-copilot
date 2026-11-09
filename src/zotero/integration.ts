import type { ProviderFactory } from "../ai/provider.ts";
import { SELECTION_LIMIT } from "../paper/retrieve.ts";
import type { Selection } from "../paper/types.ts";
import { resolveLanguage } from "../storage/settings.ts";
import type { Settings } from "../storage/settings.ts";
import { html } from "../ui/dom.ts";
import { tr } from "../ui/i18n.ts";
import { Sidebar } from "../ui/sidebar.ts";
import { PaperAccess } from "./paper-access.ts";
import { mountBesideReader, toolbarControl } from "./reader-host.ts";
import type { Reader } from "./reader-host.ts";

interface Entry {
  reader: Reader;
  sidebar?: Sidebar;
  control?: HTMLButtonElement;
  dispose(): void;
}

function selectionFrom(text: unknown, label: unknown, position: unknown, key?: string): Selection | undefined {
  if (typeof text !== "string" || !text.trim() || !position || typeof position !== "object") return;
  const { pageIndex, nextPageRects } = position as { pageIndex?: unknown; nextPageRects?: unknown };
  if (typeof pageIndex !== "number" || !Number.isSafeInteger(pageIndex) || pageIndex < 0) return;
  return {
    text: text.trim().slice(0, SELECTION_LIMIT),
    pageIndex,
    endPageIndex: Array.isArray(nextPageRects) && nextPageRects.length ? pageIndex + 1 : undefined,
    pageLabel: typeof label === "string" ? label.slice(0, 64) : undefined,
    annotationKey: key,
  };
}

export function connectReader(pluginID: string, settings: Settings, createProvider: ProviderFactory, openPreferences: () => void) {
  const entries = new Map<string, Entry>();
  const language = () => resolveLanguage(settings.language, Zotero.locale);
  const create = (doc: Document, reader: Reader): Entry | undefined => {
    const attachment = reader.itemID && Zotero.Items.get(reader.itemID);
    const host = reader._iframe?.ownerDocument;
    if (!attachment || !attachment.isPDFAttachment() || !host) return;
    const entry: Entry = { reader, dispose };
    const sidebar = new Sidebar({
      doc: host, reader, settings, createProvider, locale: Zotero.locale, openPreferences,
      access: new PaperAccess(reader, attachment),
      onVisibilityChange: (open) => {
        entry.control?.setAttribute("aria-expanded", String(open));
        if (!open) entry.control?.focus();
      },
    });
    const unmount = mountBesideReader(reader, sidebar.root);
    if (unmount) entry.sidebar = sidebar;
    else sidebar.dispose();
    const win = doc.defaultView;
    function dispose() {
      if (!entries.delete(reader._instanceID)) return;
      sidebar.dispose();
      unmount?.();
      try {
        entry.control?.remove();
        doc.querySelectorAll<HTMLButtonElement>(".zrc-selection-control").forEach((control) => control.remove());
        win?.removeEventListener("pagehide", dispose);
      } catch {
        // The reader's document can already be gone after a tab unload.
      }
    }
    win?.addEventListener("pagehide", dispose, { once: true });
    entries.set(reader._instanceID, entry);
    return entry;
  };

  const toolbar: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> = ({ doc, append, reader }) => {
    const entry = entries.get(reader._instanceID) ?? create(doc, reader);
    if (!entry) return;
    entry.control?.remove();
    const control = toolbarControl(doc, "AI", "Zotero Research Copilot", () => {
      if (entry.sidebar) entry.sidebar.setOpen(entry.sidebar.root.hidden);
      else {
        control.textContent = tr(language(), "AI unavailable", "AI 侧栏不可用");
        control.title = tr(language(), "This reader layout could not mount the AI sidebar.", "当前阅读器布局无法挂载 AI 侧栏。");
      }
    });
    control.setAttribute("aria-expanded", String(entry.sidebar?.root.hidden === false));
    entry.control = control;
    append(control);
  };

  const selection: _ZoteroTypes.Reader.EventHandler<"renderTextSelectionPopup"> = ({ doc, append, params, reader }) => {
    const sidebar = entries.get(reader._instanceID)?.sidebar;
    if (!sidebar) return;
    const data = params.annotation;
    const selected = selectionFrom(data?.text, data?.pageLabel, data?.position);
    if (!selected) return;
    const control = html(doc, "button", "toolbar-button wide-button zrc-selection-control", tr(language(), "AI Explain", "AI 解释"));
    control.type = "button";
    control.addEventListener("click", () => sidebar.explain(selected));
    append(control);
  };

  const annotation: _ZoteroTypes.Reader.EventHandler<"createAnnotationContextMenu"> = ({ append, params, reader }) => {
    const sidebar = entries.get(reader._instanceID)?.sidebar;
    const key = params.ids.length === 1 ? params.ids[0] : undefined;
    if (!sidebar || !key || !reader.itemID) return;
    const attachment = Zotero.Items.get(reader.itemID);
    if (!attachment) return;
    const item = attachment.getAnnotations().find((entry) => entry.key === key);
    if (!item?.annotationText) return;
    let selected: Selection | undefined;
    try {
      selected = selectionFrom(item.annotationText, item.annotationPageLabel, JSON.parse(item.annotationPosition), key);
    } catch {
      return;
    }
    if (!selected) return;
    const context = selected;
    append({ label: tr(language(), "AI Explain annotation", "AI 解释批注"), onCommand: () => sidebar.explain(context) });
  };

  Zotero.Reader.registerEventListener("renderToolbar", toolbar, pluginID);
  Zotero.Reader.registerEventListener("renderTextSelectionPopup", selection, pluginID);
  Zotero.Reader.registerEventListener("createAnnotationContextMenu", annotation, pluginID);
  const observer = Zotero.Notifier.registerObserver({
    notify(event, type, ids) {
      if (type !== "tab" || (String(event) !== "unload" && event !== "close")) return;
      const tabIDs = new Set(ids.flat());
      for (const entry of entries.values()) {
        if (entry.reader.tabID && tabIDs.has(entry.reader.tabID)) entry.dispose();
      }
    },
  }, ["tab"], "research-copilot");

  return () => {
    Zotero.Reader.unregisterEventListener("renderToolbar", toolbar);
    Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", selection);
    Zotero.Reader.unregisterEventListener("createAnnotationContextMenu", annotation);
    Zotero.Notifier.unregisterObserver(observer);
    for (const entry of entries.values()) entry.dispose();
  };
}
