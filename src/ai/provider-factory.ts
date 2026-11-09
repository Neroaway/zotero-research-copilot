import { ChatCompletionsProvider } from "./chat-completions.ts";
import { ClaudeProvider } from "./claude.ts";
import { OpenAIProvider } from "./openai.ts";
import type { ProviderFactory } from "./provider.ts";

export function providerFactory(send: typeof fetch): ProviderFactory {
  return (connection) => {
    switch (connection.id) {
      case "claude": return new ClaudeProvider(send);
      case "mimo":
      case "compatible": return new ChatCompletionsProvider(send, connection);
      case "openai":
      case "deepseek":
      case "grok": return new OpenAIProvider(send, connection);
    }
  };
}
