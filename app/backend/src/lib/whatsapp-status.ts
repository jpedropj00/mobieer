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
  webhook: { verifyTokenSet: boolean; appSecretSet: boolean; url: string };
  warnings: string[];
  error?: string;
};

const TEST_NUMBER_NAMES = ["test number", "número de teste"];

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
      webhook,
      warnings: ["WhatsApp não configurado: as mensagens são montadas e ficam só no log do servidor."],
    };
  }

  const warnings: string[] = [];
  let number: WhatsAppStatus["number"] = null;
  let templates: WhatsAppTemplate[] = [];

  const num = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string }>(
    `${env.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`
  );
  if (!num.ok) {
    return { configured: true, number: null, templates: [], webhook, warnings, error: num.body.error?.message ?? `Erro ${num.status} ao consultar o número na Meta` };
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

  return { configured: true, number, templates, webhook, warnings };
}
