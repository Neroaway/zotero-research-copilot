import { UITool } from "zotero-plugin-toolkit";

const ui = new UITool();

export function html<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className = "", text?: string,
): HTMLElementTagNameMap[K] {
  const node = ui.createElement(doc, tag, {
    namespace: "html",
    enableElementDOMLog: false,
    enableElementRecord: false,
  });
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(doc: Document, label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const node = html(doc, "button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}
