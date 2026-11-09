import { html } from "../ui/dom.ts";

export type Reader = _ZoteroTypes.ReaderInstance;

const CONTENT = "chrome://zrc-copilot/content/";

/**
 * Zotero 10.0.8 has no reader right-panel registration hook. The toolbar hook
 * supplies the ReaderInstance; its browser is a direct child of tab-content
 * or the standalone reader's vbox. Keep the native browser in place.
 */
export function mountBesideReader(reader: Reader, panel: HTMLElement): (() => void) | undefined {
  const browser = reader._iframe;
  const parent = browser?.parentElement;
  if (!parent || !browser || browser.localName !== "browser") return;
  const doc = browser.ownerDocument;
  const standalone = parent.id === "zotero-reader" && parent.parentElement?.localName === "hbox";
  if (parent.localName !== "tab-content" && !standalone) return;

  const css = ["copilot.css", "katex.min.css"].map((file) => {
    const pi = doc.createProcessingInstruction("xml-stylesheet", `href="${CONTENT}${file}" type="text/css"`);
    doc.insertBefore(pi, doc.documentElement);
    return pi;
  });

  if (standalone) parent.after(panel);
  else browser.after(panel);
  return () => {
    panel.remove();
    css.forEach((item) => item.remove());
  };
}

export function toolbarControl(doc: Document, label: string, title: string, onClick: () => void) {
  const button = html(doc, "button", "toolbar-button wide-button zrc-toolbar", label);
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", onClick);
  return button;
}
