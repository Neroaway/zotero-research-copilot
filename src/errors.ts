export type ErrorCode =
  | "missing-key" | "locked-key" | "input-limit" | "empty-input" | "no-text" | "insufficient-analysis-text"
  | "file-unavailable" | "file-changed" | "reader-layout" | "invalid-page"
  | "capture-unavailable" | "image-format" | "image-size" | "image-model"
  | "not-editable" | "note-failed" | "navigation-failed"
  | "obsidian-unconfigured" | "obsidian-path" | "obsidian-write"
  | "api-url" | "network" | "timeout" | "auth" | "permission" | "model-unavailable" | "model-list" | "rate-limit" | "quota"
  | "bad-request" | "server" | "stream" | "incomplete" | "output-limit" | "refusal" | "empty-response";

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
