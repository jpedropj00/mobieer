/**
 * Contrato do provedor de IA do assistente. O resto do módulo só conhece esta
 * interface: trocar o Gemini por outro provedor é escrever outra implementação
 * e mudar `provider/index.ts`.
 */
import type { ChatTurn } from "../assistant.rules";

/** Ferramenta no formato do MCP: nome, descrição e esquema JSON dos parâmetros. */
export type ToolDeclaration = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolCall = { name: string; args: Record<string, unknown> };

export type RunInput = {
  system: string;
  history: ChatTurn[];
  /** Pergunta já acompanhada do bloco de documentação. */
  message: string;
  tools: ToolDeclaration[];
  /** Executa a ferramenta pedida pelo modelo. O retorno volta para o modelo como dado. */
  executeTool: (call: ToolCall) => Promise<unknown>;
  maxToolRounds?: number;
};

export type RunOutput = { text: string; toolsUsed: string[] };

export interface AiProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Sem embeddings, a busca na documentação é feita por palavras. */
  readonly embeddings: boolean;
  run(input: RunInput): Promise<RunOutput>;
  /** `document` para indexar, `query` para buscar. */
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export class AiProviderError extends Error {
  /** `detail` é só para o log do servidor (motivo informado pelo provedor), nunca para o usuário. */
  constructor(message: string, readonly retryable = false, readonly status?: number, readonly detail?: string) {
    super(message);
  }
}
