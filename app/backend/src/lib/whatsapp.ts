import { env } from "../config/env";

/**
 * Envio de mensagens de WhatsApp com dois modos:
 *  - fallback : imprime a mensagem no log (sem credencial da Meta).
 *  - meta     : WhatsApp Business Platform / Cloud API (Graph API), sem SDK.
 *
 * Ative preenchendo WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID no .env.
 * Nenhuma credencial ou conteúdo sensível volta na resposta HTTP da API:
 * a entrega acontece apenas por este canal.
 */

export type WhatsAppResult = { delivered: boolean; id?: string; skipped?: boolean; error?: string };

/** Normaliza um telefone BR para o formato E.164 sem "+", ex: 5585999999999. */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`; // DDD + número
  if (d.length === 8 || d.length === 9) return null; // sem DDD, não dá para inferir
  return d;
}

async function metaSend(payload: Record<string, unknown>): Promise<WhatsAppResult> {
  const url = `https://graph.facebook.com/${env.whatsapp.graphVersion}/${env.whatsapp.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.whatsapp.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) {
      const error = body?.error?.message || `HTTP ${res.status}`;
      console.error(`[whatsapp] Meta falhou: ${error}`);
      return { delivered: false, error };
    }
    return { delivered: true, id: body?.messages?.[0]?.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[whatsapp] Meta erro de rede: ${error}`);
    return { delivered: false, error };
  }
}

function logFallback(to: string, text: string): WhatsAppResult {
  console.info(
    ["", "──────────── WHATSAPP (modo log) ────────────", `Para: ${to}`, "", text, "─────────────────────────────────────────────", ""].join("\n")
  );
  return { delivered: false, skipped: true };
}

/** Mensagem de texto livre (só funciona dentro da janela de 24h do cliente). */
export async function sendWhatsAppText(to: string | null | undefined, text: string): Promise<WhatsAppResult> {
  const num = toWhatsAppNumber(to);
  if (!num) return { delivered: false, skipped: true, error: "telefone ausente/inválido" };
  if (!env.whatsapp.enabled) return logFallback(num, text);
  return metaSend({ to: num, type: "text", text: { body: text, preview_url: false } });
}

/**
 * Mensagem por template aprovado na Meta (necessário para iniciar conversa
 * fora da janela de 24h). `params` preenche as variáveis {{1}}, {{2}}... do corpo.
 */
export async function sendWhatsAppTemplate(
  to: string | null | undefined,
  templateName: string,
  params: string[] = [],
  lang = env.whatsapp.templateLang
): Promise<WhatsAppResult> {
  const num = toWhatsAppNumber(to);
  if (!num) return { delivered: false, skipped: true, error: "telefone ausente/inválido" };
  if (!env.whatsapp.enabled) return logFallback(num, `[template ${templateName}] ${params.join(" | ")}`);
  return metaSend({
    to: num,
    type: "template",
    template: {
      name: templateName,
      language: { code: lang },
      ...(params.length
        ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }] }
        : {}),
    },
  });
}
