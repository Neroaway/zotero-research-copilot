export interface Paper {
  readonly itemID: number;
  readonly attachmentKey: string;
  readonly libraryID: number;
  readonly title: string;
}

export type BlockKind = "heading" | "paragraph" | "math" | "caption" | "table";

export interface TextBlock {
  kind: BlockKind;
  text: string;
}

export interface PdfPage {
  pageIndex: number;
  label?: string;
  blocks: TextBlock[];
}

export type Section =
  | "abstract" | "intro" | "related" | "method" | "experiments"
  | "results" | "ablation" | "limitations" | "conclusion" | "appendix" | "references" | "unknown";

export interface PageLocation {
  pageIndex: number;
  pageLabel?: string;
  annotationKey?: string;
  endPageIndex?: number;
}

export interface Chunk extends PageLocation {
  id: string;
  block: number;
  section: Section;
  heading?: string;
  kind: BlockKind;
  text: string;
}

export interface Selection extends PageLocation {
  text: string;
}

export type VisualInput =
  | { kind: "page"; location: PageLocation; dataURL: string }
  | { kind: "upload"; dataURL: string };

export type SourceEvidence =
  | { kind: "pdf"; location: PageLocation; block?: number; blockKind?: BlockKind; section?: Section; heading?: string; excerpt: string }
  | { kind: "page-image"; location: PageLocation }
  | { kind: "upload" };

export interface Evidence {
  id: string;
  attachment: Pick<Paper, "itemID" | "attachmentKey" | "libraryID">;
  source: SourceEvidence;
}
