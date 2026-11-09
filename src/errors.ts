export type ErrorCode =
  | "missing-key" | "locked-key" | "input-limit" | "empty-input" | "no-text" | "insufficient-analysis-text"
  | "file-unavailable" | "file-changed" | "reader-layout" | "invalid-page"
  | "capture-unavailable" | "image-format" | "image-size"
  | "not-editable" | "note-failed" | "navigation-failed"
  | "network" | "timeout" | "auth" | "permission" | "rate-limit" | "quota"
  | "bad-request" | "server" | "stream" | "incomplete" | "refusal" | "empty-response";

export class CopilotError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;

  constructor(code: ErrorCode, status?: number) {
    super(code);
    this.name = "CopilotError";
    this.code = code;
    this.status = status;
  }
}
