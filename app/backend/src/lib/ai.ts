import { env } from "../config/env";

/**
 * Cliente de IA mínimo, compatível com a API de "chat completions" da OpenAI.
 * Serve OpenAI, xAI/Grok e qualquer provedor compatível trocando
 * AI_BASE_URL + AI_API_KEY + AI_MODEL no .env. Sem SDK.
 *
 * Sem AI_API_KEY o `aiEnabled` é false e quem chama deve usar um fallback local.
 */

export const aiEnabled = () => env.ai.enabled && Boolean(env.ai.apiKey);

export class AiError extends Error {}

type ChatOptions = {
  system?: string;
  prompt: string;
  /** Pede resposta em JSON (response_format=json_object quando o provedor suporta). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

export async function aiComplete(opts: ChatOptions): Promise<string> {
  if (!aiEnabled()) throw new AiError("IA não configurada (defina AI_API_KEY)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);
  try {
    const res = await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.ai.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.ai.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1500,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.prompt },
        ],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) throw new AiError(body?.error?.message || `HTTP ${res.status}`);
    const content = body?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new AiError("resposta vazia da IA");
    return content;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new AiError("tempo limite da IA excedido");
    throw new AiError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Igual a `aiComplete({ json: true })` mas já com JSON.parse e mensagem de erro amigável. */
export async function aiJson<T = unknown>(opts: Omit<ChatOptions, "json">): Promise<T> {
  const raw = await aiComplete({ ...opts, json: true });
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError("a IA não devolveu JSON válido");
  }
}
