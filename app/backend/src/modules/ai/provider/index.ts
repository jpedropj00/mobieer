/**
 * Ponto único de escolha do provedor do assistente.
 *
 * ASSISTANT_PROVIDER="gemini" | "openai" força um; vazio escolhe sozinho:
 * Gemini quando há GEMINI_API_KEY, senão o provedor compatível com a OpenAI
 * de AI_BASE_URL/AI_API_KEY (Groq, OpenRouter…).
 */
import { env } from "../../../config/env";
import { geminiProvider } from "./gemini";
import { openAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./types";

let current: AiProvider | null = null;

export function aiProvider(): AiProvider {
  if (!current) {
    const choice = env.assistant.provider || (env.assistant.apiKey ? "gemini" : "openai");
    current = choice === "gemini" ? geminiProvider() : openAiCompatibleProvider();
  }
  return current;
}

export { AiProviderError } from "./types";
export type { AiProvider, ToolCall, ToolDeclaration } from "./types";
