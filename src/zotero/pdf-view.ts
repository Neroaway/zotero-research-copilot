import { CopilotError } from "../errors.ts";
import { paragraphBlocks } from "../paper/text.ts";
import type { PdfPage, VisualInput } from "../paper/types.ts";
import type { Reader } from "./reader-host.ts";

interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

declare const cloneReaderData: <T>(value: T, target: Window) => T;
declare const unwrapReaderObject: <T>(value: T) => T;

interface PdfPageProxy {
  readonly view: number[];
  getTextContent(): Promise<{ items: TextItem[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPageProxy>;
  getPageLabels?(): Promise<string[] | null>;
}

interface ViewerWindow extends Window {
  PDFViewerApplication?: { pdfDocument?: PdfDocument };
}

interface PdfView {
  _iframeWindow?: ViewerWindow;
  _pdfRenderer?: { renderRegionCrops(pageIndex: number, rects: number[][]): Promise<string[]> };
}

function primaryView(reader: Reader): PdfView | undefined {
  const inner = reader._internalReader as unknown as { _primaryView?: PdfView };
  return inner?._primaryView;
}

/** PDF.js is already loaded by the reader. Keep its private host bridge in one module. */
export function activePdf(reader: Reader): PdfDocument | undefined {
  const document = primaryView(reader)?._iframeWindow?.PDFViewerApplication?.pdfDocument;
  const pdf = document && unwrapReaderObject(document);
  return pdf && typeof pdf.getPage === "function" && Number.isSafeInteger(pdf.numPages) ? pdf : undefined;
}

export async function readViewPages(
  pdf: PdfDocument, limit: number, onPage: (processed: number, total: number) => void, signal: AbortSignal,
): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  const labels = await pdf.getPageLabels?.().catch(() => null);
  const total = Math.min(pdf.numPages, limit);
  for (let pageIndex = 0; pageIndex < total; pageIndex++) {
    signal.throwIfAborted();
    const blocks = await pdf.getPage(pageIndex + 1).then(async (page) => {
      const { items } = await unwrapReaderObject(page).getTextContent();
      const text = items.map(({ str, hasEOL }) => typeof str === "string" ? str + (hasEOL ? "\n" : "") : "").join("");
      return paragraphBlocks(text);
    }).catch(() => []);
    pages.push({ pageIndex, label: labels?.[pageIndex], blocks });
    onPage(pageIndex + 1, total);
  }
  return pages;
}

export async function renderPdfPage(reader: Reader, pageIndex: number): Promise<VisualInput> {
  const pdf = activePdf(reader);
  const renderer = primaryView(reader)?._pdfRenderer;
  const readerWindow = reader._iframeWindow;
  if (!pdf || !readerWindow || typeof renderer?.renderRegionCrops !== "function") {
    throw new CopilotError("capture-unavailable");
  }
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) throw new CopilotError("invalid-page");
  try {
    // A page proxy resolves across compartments. Gecko's Xray view hides
    // its prototype getters, including the PDF bounds used by the renderer.
    const page = unwrapReaderObject(await pdf.getPage(pageIndex + 1));
    const rect = Array.from(page.view);
    if (rect.length !== 4 || !rect.every(Number.isFinite)) throw new Error();
    // Native Reading Mode uses this renderer for PDF regions. Passing the
    // PDF page bounds renders just that page without creating an annotation.
    const crops = await renderer.renderRegionCrops(pageIndex, cloneReaderData([rect], readerWindow));
    const dataURL = crops[0];
    if (!dataURL?.startsWith("data:image/png;base64,") || dataURL.length > 8_000_000) throw new Error();
    const labels = await pdf.getPageLabels?.().catch(() => null);
    return { kind: "page", dataURL, location: { pageIndex, pageLabel: labels?.[pageIndex] } };
  } catch {
    throw new CopilotError("capture-unavailable");
  }
}
