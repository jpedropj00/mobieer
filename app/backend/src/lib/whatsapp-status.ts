/**
 * Situação da conta do WhatsApp na Meta: número conectado e templates aprovados.
 * Serve para a tela de automações mostrar o que está pronto e avisar do que falta
 * (número de teste, template sem versão em português, webhook sem segredo).
 */
import { env } from "../config/env";

export type WhatsAppTemplate = { name: string; language: string; status: string; category: string };
export type WhatsAppStatus = {
  configured: boolean;
  number: { displayPhoneNumber: string; verifiedName: string; qualityRating: string | null; verified: boolean; isTestNumber: boolean } | null;
  templates: WhatsAppTemplate[];
  /** Validade do token: `expiresAt` nulo = token permanente (System User). */
  token: { valid: boolean; expiresAt: string | null; expired: boolean; daysLeft: number | null };
  webhook: { verifyTokenSet: boolean; appSecretSet: boolean; url: string };
  warnings: string[];
  error?: string;
};

const TEST_NUMBER_NAMES = ["test number", "número de teste"];

/** Token sem validade conhecida: a tela não afirma nada sobre expiração. */
const UNKNOWN_TOKEN: WhatsAppStatus["token"] = { valid: true, expiresAt: null, expired: false, daysLeft: null };

/**
 * Validade do token de acesso. O token temporário do painel da Meta dura 24h;
 * quando ele vence, todo envio passa a falhar com OAuthException 190 e a causa
 * não aparece em lugar nenhum. Aqui ela aparece — antes e depois de vencer.
 */
async function tokenInfo(): Promise<{ token: WhatsAppStatus["token"]; warning?: string }> {
  const t = encodeURIComponent(env.whatsapp.token);
  const res = await graph<{ data?: { is_valid?: boolean; expires_at?: number } }>(`debug_token?input_token=${t}&access_token=${t}`);
  if (!res.ok || !res.body.data) return { token: UNKNOWN_TOKEN };

  const { is_valid: isValid = true, expires_at: expiresAt = 0 } = res.body.data;
  // expires_at = 0 é o token permanente de System User: não vence.
  if (!expiresAt) {
    return isValid
      ? { token: { valid: true, expiresAt: null, expired: false, daysLeft: null } }
      : { token: { valid: false, expiresAt: null, expired: false, daysLeft: null }, warning: "O token do WhatsApp foi revogado na Meta. Gere um novo e atualize WHATSAPP_TOKEN." };
  }

  const when = new Date(expiresAt * 1000);
  // arredonda para cima: faltando 1h30 o aviso diz "1 dia", nunca "0 dias"
  const daysLeft = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
  const expired = !isValid || when.getTime() <= Date.now();
  const fmt = when.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
  return {
    token: { valid: isValid, expiresAt: when.toISOString(), expired, daysLeft: expired ? 0 : daysLeft },
    warning: expired
      ? `O token do WhatsApp expirou em ${fmt} e nenhuma mensagem está saindo. Gere um token permanente (System User) no painel da Meta e atualize WHATSAPP_TOKEN.`
      : daysLeft <= 7
        ? `O token do WhatsApp expira em ${fmt} (${daysLeft} dia(s)). Troque por um token permanente de System User para não parar de enviar.`
        : undefined,
  };
}

async function graph<T>(path: string): Promise<{ ok: boolean; status: number; body: T & { error?: { message?: string } } }> {
  const res = await fetch(`https://graph.facebook.com/${env.whatsapp.graphVersion}/${path}`, {
    headers: { Authorization: `Bearer ${env.whatsapp.token}` },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  return { ok: res.ok, status: res.status, body };
}

export async function whatsappStatus(): Promise<WhatsAppStatus> {
  const webhook = {
    verifyTokenSet: Boolean(env.whatsapp.webhookVerifyToken),
    appSecretSet: Boolean(env.whatsapp.appSecret),
    url: `${env.apiUrl}/api/integrations/whatsapp/webhook`,
  };
  if (!env.whatsapp.enabled || !env.whatsapp.token || !env.whatsapp.phoneNumberId) {
    return {
      configured: false,
      number: null,
      templates: [],
      token: UNKNOWN_TOKEN,
      webhook,
      warnings: ["WhatsApp não configurado: as mensagens são montadas e ficam só no log do servidor."],
    };
  }

  const warnings: string[] = [];
  let number: WhatsAppStatus["number"] = null;
  let templates: WhatsAppTemplate[] = [];

  // A validade do token vem primeiro: se ele venceu, é essa a explicação de
  // tudo o que falhar abaixo, e o aviso precisa aparecer mesmo assim.
  const { token, warning: tokenWarning } = await tokenInfo();
  if (tokenWarning) warnings.push(tokenWarning);

  const num = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>(
    `${env.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`
  );
  if (!num.ok) {
    return {
      configured: true,
      number: null,
      templates: [],
      token,
      webhook,
      warnings,
      error: num.body.error?.message ?? `Erro ${num.status} ao consultar o número na Meta`,
    };
  }
  const verifiedName = num.body.verified_name ?? "";
  const isTestNumber = TEST_NUMBER_NAMES.some((t) => verifiedName.toLowerCase().includes(t));
  number = {
    displayPhoneNumber: num.body.display_phone_number ?? "",
    verifiedName,
    qualityRating: num.body.quality_rating ?? null,
    verified: num.body.code_verification_status === "VERIFIED",
    isTestNumber,
  };
  if (isTestNumber) {
    warnings.push(
      "Este é o número de teste da Meta: ele só envia para os telefones cadastrados como destinatários de teste no painel. Para falar com clientes de verdade, conecte o número da loja."
    );
  }

  if (env.whatsapp.accountId) {
    const tpl = await graph<{ data?: WhatsAppTemplate[] }>(`${env.whatsapp.accountId}/message_templates?limit=100&fields=name,status,language,category`);
    if (tpl.ok && tpl.body.data) {
      templates = tpl.body.data;
      const approvedPt = templates.filter((t) => t.status === "APPROVED" && t.language.toLowerCase().startsWith("pt"));
      if (!approvedPt.length) {
        warnings.push(
          "Nenhum template aprovado em português. Sem template, o WhatsApp só entrega mensagem se o cliente tiver falado com a loja nas últimas 24h."
        );
      }
    } else {
      warnings.push(`Não foi possível listar os templates: ${tpl.body.error?.message ?? `erro ${tpl.status}`}`);
    }
  } else {
    warnings.push("Defina WHATSAPP_ACCOUNT_ID (id da conta do WhatsApp Business) para listar os templates aprovados.");
  }

  if (!webhook.verifyTokenSet) warnings.push("WHATSAPP_VERIFY_TOKEN vazio: o webhook de respostas (CONFIRMAR/REMARCAR) não pode ser validado na Meta.");
  if (!webhook.appSecretSet) warnings.push("WHATSAPP_APP_SECRET vazio: as chamadas do webhook entram sem conferir a assinatura da Meta.");

  return { configured: true, number, templates, token, webhook, warnings };
}
