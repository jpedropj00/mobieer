/**
 * Provedor no padrão "chat completions" da OpenAI (Groq, OpenRouter, xAI,
 * OpenAI…), configurado por AI_BASE_URL + AI_API_KEY + AI_MODEL — as mesmas
 * variáveis do cronograma de produção. Sem SDK.
 *
 * Nem todo provedor desse padrão tem embeddings (o Groq não tem): por isso
 * `embeddings` é false e a busca na documentação usa a busca por palavras.
 */
import { env } from "../../../config/env";
import { AiProviderError, type AiProvider, type RunInput, type RunOutput } from "./types";

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

type ToolCallMsg = { id: string; type: "function"; function: { name: string; arguments: string } };
type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallMsg[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function post(body: Record<string, unknown>): Promise<{ content: string | null; tool_calls?: ToolCallMsg[] }> {
  const cfg = env.ai;
  let last: AiProviderError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
        throw new AiProviderError(`o provedor de IA respondeu HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status, `${err.error?.code ?? ""} ${err.error?.message ?? ""}`.trim().slice(0, 300));
      }
      const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCallMsg[] } }[] };
      const message = json.choices?.[0]?.message;
      if (!message) throw new AiProviderError("resposta vazia do provedor de IA", true);
      return { content: message.content ?? null, tool_calls: message.tool_calls };
    } catch (e) {
      last =
        e instanceof AiProviderError
          ? e
          : e instanceof Error && e.name === "AbortError"
            ? new AiProviderError("tempo limite do provedor de IA excedido", true)
            : new AiProviderError("falha de comunicação com o provedor de IA", true);
      if (!last.retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last!;
}

export function openAiCompatibleProvider(): AiProvider {
  const cfg = env.ai;
  const enabled = Boolean(cfg.apiKey);

  return {
    name: "openai-compatible",
    enabled,
    embeddings: false,

    async run(input: RunInput): Promise<RunOutput> {
      if (!enabled) throw new AiProviderError("Mobieer AI não configurado (defina AI_API_KEY)");
      const messages: Msg[] = [{ role: "system", content: input.system }, ...input.history.map((t): Msg => ({ role: t.role, content: t.content })), { role: "user", content: input.message }];
      const tools = input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      const toolsUsed: string[] = [];
      const rounds = input.maxToolRounds ?? 3;

      for (let round = 0; ; round++) {
        const withTools = tools.length > 0 && round < rounds;
        const msg = await post({ model: cfg.model, temperature: 0.2, max_tokens: 1500, messages, ...(withTools ? { tools, tool_choice: "auto" } : {}) });
        const calls = withTools ? msg.tool_calls ?? [] : [];
        if (!calls.length) return { text: msg.content ?? "", toolsUsed };

        messages.push({ role: "assistant", content: msg.content, tool_calls: calls });
        for (const call of calls) {
          const name = call.function?.name ?? "";
          let content: string;
          try {
            let args: Record<string, unknown> = {};
            try {
              args = call.function?.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
            } catch {
              throw new Error("Parâmetros inválidos para a ferramenta.");
            }
            content = JSON.stringify({ result: await input.executeTool({ name, args }) });
            if (!toolsUsed.includes(name)) toolsUsed.push(name);
          } catch (e) {
            content = JSON.stringify({ error: e instanceof Error ? e.message : "falha ao executar a ferramenta" });
          }
          messages.push({ role: "tool", tool_call_id: call.id, content });
        }
      }
    },

    async embed() {
      throw new AiProviderError("este provedor não gera embeddings");
    },
  };
}
