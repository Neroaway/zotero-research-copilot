import type { SourceEvidence } from "../paper/types.ts";
import type { Language } from "../storage/settings.ts";
import { tr } from "./i18n.ts";

export function evidenceLabel(source: SourceEvidence, language: Language, compact = false): string {
  const t = (en: string, zh: string) => tr(language, en, zh);
  if (source.kind === "upload") return t("Attached image · page unverified", "附图 · 页码未核实");
  const { pageIndex, endPageIndex, pageLabel, annotationKey } = source.location;
  const page = endPageIndex === undefined ? String(pageIndex + 1) : `${pageIndex + 1}–${endPageIndex + 1}`;
  if (compact) {
    if (source.kind === "page-image") return t(`Image p. ${page}`, `第 ${page} 页图像`);
    return t(`p. ${page}`, `第 ${page} 页`);
  }
  const parts = [t(`PDF page ${page}`, `PDF 第 ${page} 页`)];
  if (pageLabel && pageLabel !== page && endPageIndex === undefined) {
    parts.push(t(`printed label ${pageLabel}`, `文档页标 ${pageLabel}`));
  }
  if (source.kind === "page-image") parts.push(t("page image", "页面图像"));
  if (annotationKey) parts.push(t("annotation", "批注"));
  else parts.push(t("page-level link", "页级定位"));
  if (source.kind === "pdf" && source.block) parts.push(t(`text block ${source.block}`, `文本块 ${source.block}`));
  return parts.join(" · ");
}
