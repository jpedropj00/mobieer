/**
 * Ponto único de escolha do provedor do assistente. Hoje: Gemini.
 */
import { geminiProvider } from "./gemini";
import type { AiProvider } from "./types";

let current: AiProvider | null = null;

export function aiProvider(): AiProvider {
  current ??= geminiProvider();
  return current;
}

export { AiProviderError } from "./types";
export type { AiProvider, ToolCall, ToolDeclaration } from "./types";
