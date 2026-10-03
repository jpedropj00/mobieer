/**
 * Provedor Gemini (SDK oficial @google/genai). A chave vem só do ambiente do
 * backend; modelo e modelo de embedding também (GEMINI_MODEL, GEMINI_EMBEDDING_MODEL).
 */
import { ApiError, GoogleGenAI, type Content } from "@google/genai";
import { env } from "../../../config/env";
import { AiProviderError, type AiProvider, type RunInput, type RunOutput } from "./types";

export const EMBEDDING_DIMENSIONS = 768;
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

function toProviderError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e;
  if (e instanceof ApiError) {
    const retryable = e.status === 429 || e.status >= 500;
    // a mensagem da API pode citar a requisição; para fora vai só o código
    return new AiProviderError(`Gemini respondeu HTTP ${e.status}`, retryable, e.status);
  }
  if (e instanceof Error && (e.name === "AbortError" || /timeout|timed out/i.test(e.message))) return new AiProviderError("tempo limite do Gemini excedido", true);
  return new AiProviderError("falha de comunicação com o Gemini", true);
}

/** Uma nova tentativa, só para erro passageiro (429, 5xx, tempo limite). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: AiProviderError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = toProviderError(e);
      if (!last.retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw last!;
}

export function geminiProvider(): AiProvider {
  const cfg = env.assistant;
  const enabled = Boolean(cfg.apiKey);
  let client: GoogleGenAI | null = null;
  const ai = () => {
    if (!enabled) throw new AiProviderError("Mobieer AI não configurado (defina GEMINI_API_KEY)");
    client ??= new GoogleGenAI({ apiKey: cfg.apiKey, httpOptions: { timeout: cfg.timeoutMs } });
    return client;
  };

  return {
    name: "gemini",
    enabled,
    embeddings: true,

    async run(input: RunInput): Promise<RunOutput> {
      const contents: Content[] = [
        ...input.history.map((t): Content => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
        { role: "user", parts: [{ text: input.message }] },
      ];
      const tools = input.tools.length ? [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }] : undefined;
      const toolsUsed: string[] = [];
      const rounds = input.maxToolRounds ?? 3;

      for (let round = 0; ; round++) {
        const res = await withRetry(() =>
          ai().models.generateContent({
            model: cfg.model,
            contents,
            // na última rodada as ferramentas saem: o modelo é obrigado a responder em texto
            config: { systemInstruction: input.system, temperature: 0.2, maxOutputTokens: 1200, tools: round < rounds ? tools : undefined },
          })
        );
        const calls = round < rounds ? res.functionCalls ?? [] : [];
        if (!calls.length) return { text: res.text ?? "", toolsUsed };

        const modelTurn = res.candidates?.[0]?.content;
        if (modelTurn) contents.push(modelTurn);
        const parts = [];
        for (const call of calls) {
          const name = call.name ?? "";
          let response: Record<string, unknown>;
          try {
            response = { result: await input.executeTool({ name, args: (call.args ?? {}) as Record<string, unknown> }) };
            if (!toolsUsed.includes(name)) toolsUsed.push(name);
          } catch (e) {
            // erro de permissão ou de parâmetro volta para o modelo explicar, sem detalhe interno
            response = { error: e instanceof Error ? e.message : "falha ao executar a ferramenta" };
          }
          parts.push({ functionResponse: { name, response } });
        }
        contents.push({ role: "user", parts });
      }
    },

    async embed(texts, kind) {
      if (!texts.length) return [];
      const out: number[][] = [];
      // lotes pequenos: a API limita o tamanho de cada chamada
      for (let i = 0; i < texts.length; i += 20) {
        const batch = texts.slice(i, i + 20);
        const res = await withRetry(() =>
          ai().models.embedContent({
            model: cfg.embeddingModel,
            contents: batch,
            config: { taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: EMBEDDING_DIMENSIONS },
          })
        );
        const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
        if (vectors.length !== batch.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) throw new AiProviderError("o Gemini devolveu embeddings fora do esperado");
        out.push(...vectors);
      }
      return out;
    },
  };
}
