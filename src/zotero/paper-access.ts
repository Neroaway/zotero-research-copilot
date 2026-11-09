import { CopilotError } from "../errors.ts";
import { MAX_PDF_PAGES, PaperIndex } from "../paper/index.ts";
import { pagesFromFullText, pagesFromSdt } from "../paper/text.ts";
import type { SdtDocument } from "../paper/text.ts";
import type { PageLocation, Paper } from "../paper/types.ts";
import { activePdf, readViewPages } from "./pdf-view.ts";
import type { Reader } from "./reader-host.ts";

interface StructuredTextReader {
  materialize(): Promise<SdtDocument>;
}

interface FullTextResult {
  text: string;
  extractedPages: number;
  totalPages: number;
}

type Extracting = (progress?: number) => void;
export type PaperVersion = number;

export class PaperAccess {
  readonly paper: Paper;
  private readonly reader: Reader;
  private cache?: { version: PaperVersion; index: PaperIndex };

  constructor(reader: Reader, attachment: Zotero.Item) {
    this.reader = reader;
    this.paper = {
      itemID: attachment.id,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      title: attachment.parentItem?.getDisplayTitle() || attachment.getDisplayTitle(),
    };
  }

  async attachment(): Promise<Zotero.Item> {
    const item = await Zotero.Items.getAsync(this.paper.itemID);
    if (!item || item.deleted || !item.isPDFAttachment() || item.key !== this.paper.attachmentKey
      || item.libraryID !== this.paper.libraryID) {
      throw new CopilotError("file-unavailable");
    }
    return item;
  }

  async version(): Promise<PaperVersion> {
    try {
      const item = await this.attachment();
      const mtime = await item.attachmentModificationTime;
      if (typeof mtime === "number" && Number.isFinite(mtime)) return mtime;
    } catch {
      // Map file API errors to the attachment's availability state.
    }
    throw new CopilotError("file-unavailable");
  }

  async load(signal: AbortSignal, onProgress: Extracting): Promise<{ index: PaperIndex; version: PaperVersion }> {
    const version = await this.version();
    signal.throwIfAborted();
    if (this.cache?.version === version) return this.cache;
    const index = await this.extract(signal, onProgress);
    signal.throwIfAborted();
    if (version !== await this.version()) throw new CopilotError("file-changed");
    signal.throwIfAborted();
    this.cache = { version, index };
    return this.cache;
  }

  async navigate(location: PageLocation, version: PaperVersion): Promise<void> {
    if (version !== await this.version()) throw new CopilotError("file-changed");
    const item = await this.attachment();
    const annotationID = location.annotationKey && item.getAnnotations().some(({ key }) => key === location.annotationKey)
      ? location.annotationKey : undefined;
    try {
      // Runtime uses annotationID (10.0.8 reader.js), with a pageIndex fallback.
      const target = { pageIndex: location.pageIndex, annotationID };
      await this.reader.navigate(target);
    } catch {
      throw new CopilotError("navigation-failed");
    }
  }

  private async extract(signal: AbortSignal, onProgress: Extracting): Promise<PaperIndex> {
    const item = await this.attachment();
    if (!await item.getFilePathAsync()) throw new CopilotError("file-unavailable");
    onProgress();
    const pdf = activePdf(this.reader);
    const app = Zotero as typeof Zotero & {
      SDT?: { getReader(id: number, options: { isPriority: boolean; onProgress: Extracting }): Promise<StructuredTextReader | null> };
      PDFWorker?: { getFullText(id: number, maxPages: number, priority: boolean): Promise<FullTextResult> };
    };
    if (app.SDT?.getReader && (!pdf || pdf.numPages <= MAX_PDF_PAGES)) {
      try {
        const pack = await app.SDT.getReader(item.id, { isPriority: true, onProgress });
        signal.throwIfAborted();
        const document = await pack?.materialize();
        if (document) {
          const pages = pagesFromSdt(document, MAX_PDF_PAGES);
          if (pages.some(({ blocks }) => blocks.length)) {
            return new PaperIndex(pages, document.catalog.pages.length, "sdt");
          }
        }
      } catch {
        signal.throwIfAborted();
      }
    }
    if (app.PDFWorker?.getFullText) {
      try {
        const raw = await app.PDFWorker.getFullText(item.id, MAX_PDF_PAGES, true);
        signal.throwIfAborted();
        const pages = pagesFromFullText(raw.text, raw.extractedPages);
        if (pages.some(({ blocks }) => blocks.length)) return new PaperIndex(pages, raw.totalPages, "pdf-worker");
      } catch {
        signal.throwIfAborted();
      }
    }
    if (pdf) {
      const pages = await readViewPages(pdf, MAX_PDF_PAGES, (done, total) => onProgress(Math.round(100 * done / total)), signal);
      return new PaperIndex(pages, pdf.numPages, "pdf-view");
    }
    return new PaperIndex([], 0, "none");
  }
}
