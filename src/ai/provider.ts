import type { ReasoningEffort } from "./reasoning.ts";
import type { ProviderConnection } from "./providers.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface AIRequest {
  model: string;
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  text: string;
  imageURL?: string;
  maxOutputTokens?: number;
}

export interface AIResult {
  text: string;
  usage?: Usage;
}

/** Transports a single turn. Paper retrieval and conversation policy stay with the caller. */
export interface AIProvider {
  generate(
    request: AIRequest,
    key: string,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    onUsage: (usage: Usage) => void,
  ): Promise<AIResult>;
}

export interface ModelProvider extends AIProvider {
  listModels(key: string, signal: AbortSignal): Promise<string[]>;
}

export type ProviderFactory = (connection: ProviderConnection) => ModelProvider;
