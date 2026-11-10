import type { AIProvider, Usage } from "../ai/provider.ts";
import type { ProviderConnection } from "../ai/providers.ts";
import type { AnalysisBudget } from "../ai/output-budget.ts";
import type { ReasoningEffort } from "../ai/reasoning.ts";
import { CopilotError } from "../errors.ts";
import { QUESTION_LIMIT, retrieve, SELECTION_LIMIT } from "../paper/retrieve.ts";
import type { AnalysisCoverage } from "../paper/retrieve.ts";
import type { PaperIndex } from "../paper/index.ts";
import type { Evidence, Paper, Selection, VisualInput } from "../paper/types.ts";
import type { Language } from "../storage/settings.ts";
import { parseAnalysis, removeCitations, verifyEvidenceLabels } from "./analysis.ts";
import type { AnalysisBranch } from "./analysis.ts";
import { buildRequest } from "./prompts.ts";
import type { HistoryEntry, TaskMode } from "./prompts.ts";
import { requestTimeoutMs } from "./timeouts.ts";
import type { ResponseTimeout } from "./timeouts.ts";

type Version = number;
type Phase = "credentials" | "indexing" | "streaming" | "done" | "failed" | "stopped";
const HISTORY_TURNS = 4;
const HISTORY_CHARS = 4_800;
export const MAX_TURNS = 30;
export const STOP_REASONS = ["user", "reader-closed", "reader-unloaded", "plugin-unloaded", "external", "restored"] as const;
export type StopReason = typeof STOP_REASONS[number];

export interface Task {
  mode: TaskMode;
  question: string;
  selection?: Selection;
  visual?: VisualInput;
  visualVersion?: Version;
}

export interface Turn {
  readonly mode: TaskMode;
  readonly question: string;
  readonly model: string;
  readonly connection?: ProviderConnection;
  readonly reasoningEffort?: ReasoningEffort;
  readonly language: Language;
  phase: Phase;
  text: string;
  evidence: Evidence[];
  usage?: Usage;
  error?: CopilotError;
  branches?: AnalysisBranch[];
  version?: Version;
  index?: Pick<PaperIndex, "totalPages" | "indexedPages" | "limited" | "method">;
  analysisCoverage?: AnalysisCoverage;
  progress?: number;
  contextChars: number;
  stopReason?: StopReason;
  timing?: { startedAt: number; finishedAt?: number; timeoutMs?: number; maxOutputTokens?: number };
}

export interface PaperLoader {
  paper: Paper;
  load(signal: AbortSignal, onProgress: (progress?: number) => void): Promise<{ index: PaperIndex; version: Version }>;
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class ResearchSession {
  readonly turns: Turn[] = [];
  private active?: AbortController;
  private activeTurn?: Turn;
  private lastTask?: Task;
  private disposed = false;

  get busy(): boolean { return !!this.active; }
  get canRetry(): boolean {
    const last = this.turns.at(-1);
    return !!this.lastTask && (last?.phase === "failed" || last?.phase === "stopped");
  }

  stop(reason: StopReason = "user"): void {
    if (!this.active || this.active.signal.aborted) return;
    if (this.activeTurn) {
      this.activeTurn.stopReason = reason;
      this.activeTurn.phase = "stopped";
      if (this.activeTurn.timing) this.activeTurn.timing.finishedAt = Date.now();
    }
    this.active.abort();
  }

  clear(): void {
    if (this.busy) return;
    this.turns.length = 0;
    this.lastTask = undefined;
  }

  restore(turns: Turn[]): void {
    if (this.busy || this.disposed) return;
    this.turns.splice(0, this.turns.length, ...turns.slice(-MAX_TURNS));
    this.lastTask = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.stop("plugin-unloaded");
    this.turns.length = 0;
    this.lastTask = undefined;
  }

  async run(options: {
    provider: AIProvider;
    connection?: ProviderConnection;
    settings: {
      model: string;
      getKey(): Promise<string | undefined>;
      reasoningEffort?: ReasoningEffort;
      analysisBudget?: AnalysisBudget;
      responseTimeout?: ResponseTimeout;
    };
    source: PaperLoader;
    language: Language;
    controller: AbortController;
    onChange: () => void;
    task?: Task;
  }): Promise<void> {
    if (this.busy || this.disposed) return;
    const task = options.task ?? this.lastTask;
    if (!task) return;
    const question = task.question.trim();
    if (!question) throw new CopilotError("empty-input");
    if (question.length > QUESTION_LIMIT) throw new CopilotError("input-limit");

    if (!options.task && this.canRetry) this.turns.pop();
    const { language, settings, source, provider, connection, controller, onChange } = options;
    const analysisBudget = settings.analysisBudget;
    const turn: Turn = {
      mode: task.mode,
      question,
      model: settings.model,
      connection,
      reasoningEffort: settings.reasoningEffort,
      language,
      phase: "credentials",
      text: "",
      evidence: [],
      contextChars: 0,
      timing: { startedAt: Date.now(), timeoutMs: requestTimeoutMs(task.mode, settings.reasoningEffort, settings.responseTimeout) },
    };
    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS) this.turns.shift();
    this.active = controller;
    this.activeTurn = turn;
    this.lastTask = task;
    const { signal } = controller;
    const update = () => { if (!this.disposed) onChange(); };
    let timedOut = false;
    const timeout = turn.timing?.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      // Keep the cause in our state as well as signal.reason, including during reader teardown.
      turn.phase = "failed";
      turn.error = new CopilotError("timeout");
      if (turn.timing) turn.timing.finishedAt = Date.now();
      controller.abort(turn.error);
    }, turn.timing.timeoutMs);
    try {
      update();
      const key = await untilAborted(settings.getKey().catch(() => { throw new CopilotError("locked-key"); }), signal);
      if (!key) throw new CopilotError("missing-key");
      turn.phase = "indexing";
      update();
      const { index, version } = await untilAborted(source.load(signal, (progress) => {
        if (signal.aborted) return;
        turn.progress = progress;
        update();
      }), signal);
      turn.version = version;
      const history = task.mode === "analysis" ? [] : this.history(connection, version);
      turn.index = {
        totalPages: index.totalPages,
        indexedPages: index.indexedPages,
        limited: index.limited,
        method: index.method,
      };
      const visual = task.visual;
      if (visual?.kind === "page" && task.visualVersion !== version) throw new CopilotError("file-changed");
      const selection = task.selection && { ...task.selection, text: task.selection.text.slice(0, SELECTION_LIMIT) };
      const lastQuestion = history.at(-1)?.question ?? "";
      const contextQuery = question.length < 100 ? `${question} ${lastQuestion.slice(0, 300)}` : question;
      const retrieval = retrieve(index, source.paper, contextQuery, task.mode, selection, visual);
      if (retrieval.analysis && !retrieval.analysis.hasBodyText) {
        throw new CopilotError("insufficient-analysis-text");
      }
      if (!retrieval.evidence.length) throw new CopilotError("no-text");
      turn.evidence = retrieval.evidence;
      turn.contextChars = retrieval.textChars;
      turn.analysisCoverage = retrieval.analysis;
      turn.phase = "streaming";
      update();
      const request = buildRequest({
        model: turn.model, reasoningEffort: turn.reasoningEffort, analysisBudget, language,
        paper: source.paper, mode: task.mode, question, history, retrieval, visual,
      });
      if (turn.timing) turn.timing.maxOutputTokens = request.maxOutputTokens;
      const result = await untilAborted(provider.generate(request, key, signal, (delta) => {
        if (signal.aborted) return;
        turn.text += delta;
        update();
      }, (usage) => {
        if (!signal.aborted) turn.usage = usage;
      }), signal);
      turn.text = verifyEvidenceLabels(result.text, turn.evidence);
      turn.usage = result.usage ?? turn.usage;
      if (turn.mode === "analysis") turn.branches = parseAnalysis(turn.text);
      turn.phase = "done";
      this.lastTask = undefined;
    } catch (error) {
      const reason: unknown = signal.aborted ? signal.reason : error;
      if (timedOut) {
        turn.phase = "failed";
        turn.error = new CopilotError("timeout");
      } else if (signal.aborted && !(reason instanceof CopilotError)) {
        turn.phase = "stopped";
        turn.stopReason ??= "external";
      } else {
        turn.phase = "failed";
        turn.error = reason instanceof CopilotError ? reason : new CopilotError("stream");
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (turn.timing) turn.timing.finishedAt ??= Date.now();
      this.active = undefined;
      this.activeTurn = undefined;
      update();
    }
  }

  private history(connection: ProviderConnection | undefined, version: Version): HistoryEntry[] {
    const history: HistoryEntry[] = [];
    let remaining = HISTORY_CHARS;
    const completed = this.turns.filter((turn) => turn.phase === "done"
      && turn.version === version
      && turn.connection?.id === connection?.id && turn.connection?.baseURL === connection?.baseURL)
      .slice(-HISTORY_TURNS).reverse();
    for (const turn of completed) {
      const question = turn.question.slice(0, Math.min(350, remaining));
      remaining -= question.length;
      const answer = removeCitations(turn.text).slice(0, Math.min(1_050, remaining));
      if (!question || !answer) break;
      remaining -= answer.length;
      history.unshift({ question, answer });
    }
    return history;
  }
}
