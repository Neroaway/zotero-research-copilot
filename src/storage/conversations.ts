import { providerConnection, PROVIDERS } from "../ai/providers.ts";
import { supportedReasoning } from "../ai/reasoning.ts";
import { CopilotError, ERROR_CODES } from "../errors.ts";
import type { Evidence, PageLocation, Paper } from "../paper/types.ts";
import { parseAnalysis } from "../research/analysis.ts";
import { MAX_TURNS, STOP_REASONS } from "../research/session.ts";
import type { Turn } from "../research/session.ts";

const MAX_FILE_CHARS = 16_000_000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const optionalCount = (value: unknown) => value === undefined || count(value);

function samePaper(value: unknown, paper: Paper): boolean {
  return record(value) && value.libraryID === paper.libraryID && value.attachmentKey === paper.attachmentKey;
}

function location(value: unknown): value is PageLocation {
  return record(value) && count(value.pageIndex) && optionalCount(value.endPageIndex)
    && (value.endPageIndex === undefined || (value.endPageIndex as number) >= value.pageIndex)
    && optionalString(value.pageLabel) && optionalString(value.annotationKey);
}

function evidence(value: unknown, paper: Paper): value is Evidence {
  if (!record(value) || typeof value.id !== "string" || !/^E[1-9]\d{0,3}$/u.test(value.id)
    || !samePaper(value.attachment, paper) || !record(value.source)) return false;
  const source = value.source;
  if (source.kind === "upload") return true;
  if (!location(source.location)) return false;
  if (source.kind === "page-image") return true;
  return source.kind === "pdf" && typeof source.excerpt === "string"
    && optionalCount(source.block) && optionalString(source.heading)
    && optionalString(source.blockKind) && optionalString(source.section);
}

function restoreTurn(value: unknown, paper: Paper): Turn {
  if (!record(value) || !["question", "selection", "analysis"].includes(String(value.mode))
    || typeof value.question !== "string" || typeof value.model !== "string" || typeof value.text !== "string"
    || !["en", "zh"].includes(String(value.language)) || !["done", "failed", "stopped"].includes(String(value.phase))
    || !count(value.contextChars) || !optionalCount(value.version) || !Array.isArray(value.evidence)
    || value.evidence.length > 256 || !value.evidence.every((entry) => evidence(entry, paper))) throw new Error("Invalid conversation turn");
  const turn: Turn = {
    mode: value.mode as Turn["mode"], question: value.question, model: value.model,
    language: value.language as Turn["language"], phase: value.phase as Turn["phase"],
    text: value.text, contextChars: value.contextChars, version: value.version as number | undefined,
    // Numeric item IDs are local to a Zotero database; restore against the stable attachment key.
    evidence: (value.evidence as Evidence[]).map((entry) => ({
      id: entry.id, source: entry.source,
      attachment: { itemID: paper.itemID, attachmentKey: paper.attachmentKey, libraryID: paper.libraryID },
    })),
  };
  if (value.stopReason !== undefined) {
    if (!STOP_REASONS.some((reason) => reason === value.stopReason)) throw new Error("Invalid interruption reason");
    turn.stopReason = value.stopReason as Turn["stopReason"];
  }
  if (value.timing !== undefined) {
    const timing = value.timing;
    if (!record(timing) || !count(timing.startedAt) || !optionalCount(timing.finishedAt)
      || !optionalCount(timing.timeoutMs) || timing.timeoutMs === 0 || !optionalCount(timing.maxOutputTokens)) throw new Error("Invalid conversation timing");
    turn.timing = timing as unknown as Turn["timing"];
  }
  if (value.connection !== undefined) {
    if (!record(value.connection) || typeof value.connection.id !== "string" || !Object.hasOwn(PROVIDERS, value.connection.id)
      || typeof value.connection.baseURL !== "string") throw new Error("Invalid conversation provider");
    const connection = providerConnection(value.connection.id as keyof typeof PROVIDERS, value.connection.baseURL);
    if (!connection || connection.baseURL !== value.connection.baseURL) throw new Error("Invalid conversation endpoint");
    Object.assign(turn, { connection, reasoningEffort: supportedReasoning(turn.model, value.reasoningEffort, connection.id) });
  }
  if (value.usage !== undefined) {
    if (!record(value.usage) || !count(value.usage.inputTokens) || !count(value.usage.outputTokens)
      || !optionalCount(value.usage.reasoningTokens) || !optionalCount(value.usage.cachedTokens)) throw new Error("Invalid conversation usage");
    turn.usage = value.usage as unknown as Turn["usage"];
  }
  if (value.error !== undefined) {
    const error = value.error;
    if (!record(error) || !ERROR_CODES.some((code) => code === error.code) || !optionalCount(error.status)) throw new Error("Invalid conversation error");
    turn.error = new CopilotError(error.code as typeof ERROR_CODES[number], error.status as number | undefined);
  }
  if (value.index !== undefined) {
    const index = value.index;
    if (!record(index) || !count(index.totalPages) || !count(index.indexedPages) || typeof index.limited !== "boolean"
      || !["sdt", "pdf-worker", "pdf-view", "none"].includes(String(index.method))) throw new Error("Invalid conversation index");
    turn.index = index as unknown as Turn["index"];
  }
  if (value.analysisCoverage !== undefined) {
    const coverage = value.analysisCoverage;
    if (!record(coverage) || !count(coverage.totalPages) || !count(coverage.indexedPages)
      || typeof coverage.limited !== "boolean" || typeof coverage.hasBodyText !== "boolean"
      || !Array.isArray(coverage.suppliedPages) || !coverage.suppliedPages.every(count)
      || !Array.isArray(coverage.suppliedSections) || !coverage.suppliedSections.every((section) => typeof section === "string")) {
      throw new Error("Invalid conversation coverage");
    }
    turn.analysisCoverage = coverage as unknown as Turn["analysisCoverage"];
  }
  if (turn.phase === "done" && turn.mode === "analysis") turn.branches = parseAnalysis(turn.text);
  return turn;
}

export function encodeConversation(paper: Paper, turns: readonly Turn[]): string {
  const json = JSON.stringify({
    schemaVersion: 1,
    paper: { libraryID: paper.libraryID, attachmentKey: paper.attachmentKey },
    // Never serialize the session, credentials, pending task, or attached image data.
    turns: turns.slice(-MAX_TURNS).map((turn) => ({
      mode: turn.mode, question: turn.question, model: turn.model, connection: turn.connection,
      reasoningEffort: turn.reasoningEffort, language: turn.language,
      phase: ["done", "failed", "stopped"].includes(turn.phase) ? turn.phase : "stopped",
      stopReason: ["done", "failed", "stopped"].includes(turn.phase) ? turn.stopReason : turn.stopReason ?? "restored",
      timing: turn.timing,
      text: turn.text, evidence: turn.evidence, usage: turn.usage,
      error: turn.error && { code: turn.error.code, status: turn.error.status },
      version: turn.version, index: turn.index, analysisCoverage: turn.analysisCoverage, contextChars: turn.contextChars,
    })),
  });
  if (json.length > MAX_FILE_CHARS) throw new Error("Conversation exceeds storage limit");
  return json;
}

export function decodeConversation(paper: Paper, json: string): Turn[] {
  if (json.length > MAX_FILE_CHARS) throw new Error("Conversation exceeds storage limit");
  const value: unknown = JSON.parse(json);
  if (!record(value) || value.schemaVersion !== 1 || !samePaper(value.paper, paper)
    || !Array.isArray(value.turns) || value.turns.length > MAX_TURNS) throw new Error("Invalid conversation file");
  return value.turns.map((turn) => restoreTurn(turn, paper));
}

export interface ConversationFiles {
  read(name: string): Promise<string | undefined>;
  write(name: string, json: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class ConversationStore {
  private readonly files: ConversationFiles;
  private readonly pending = new Map<string, Promise<void>>();

  constructor(files: ConversationFiles) { this.files = files; }

  load(paper: Paper): Promise<Turn[]> {
    return this.enqueue(paper, async (name) => {
      try {
        const json = await this.files.read(name);
        return json === undefined ? [] : decodeConversation(paper, json);
      } catch { throw new CopilotError("history-read"); }
    });
  }

  save(paper: Paper, turns: readonly Turn[]): Promise<void> {
    // Snapshot now: reader disposal clears the in-memory session immediately.
    let json: string | undefined;
    try { json = turns.length ? encodeConversation(paper, turns) : undefined; }
    catch { return Promise.reject(new CopilotError("history-write")); }
    return this.enqueue(paper, async (name) => {
      try {
        if (json === undefined) await this.files.remove(name);
        else await this.files.write(name, json);
      } catch { throw new CopilotError("history-write"); }
    });
  }

  async flush(): Promise<void> { await Promise.all(this.pending.values()); }

  private enqueue<T>(paper: Paper, operation: (name: string) => Promise<T>): Promise<T> {
    if (!count(paper.libraryID) || !/^[A-Z0-9]{8}$/u.test(paper.attachmentKey)) return Promise.reject(new Error("Invalid attachment identity"));
    const name = `${paper.libraryID}-${paper.attachmentKey}.json`;
    const next = (this.pending.get(name) ?? Promise.resolve()).then(() => operation(name));
    const settled = next.then(() => {}, () => {});
    this.pending.set(name, settled);
    void settled.then(() => { if (this.pending.get(name) === settled) this.pending.delete(name); });
    return next;
  }
}

export function zoteroConversations(): ConversationStore {
  const directory = PathUtils.join(Zotero.DataDirectory.dir, "research-copilot", "conversations");
  return new ConversationStore({
    async read(name) {
      const path = PathUtils.join(directory, name);
      return await IOUtils.exists(path) ? IOUtils.readUTF8(path) : undefined;
    },
    async write(name, json) {
      await IOUtils.makeDirectory(directory, { ignoreExisting: true, createAncestors: true });
      const path = PathUtils.join(directory, name);
      await IOUtils.writeUTF8(path, json, { tmpPath: path + ".tmp", flush: true });
    },
    async remove(name) { await IOUtils.remove(PathUtils.join(directory, name), { ignoreAbsent: true }); },
  });
}
