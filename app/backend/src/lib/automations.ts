/**
 * Automações de mensagem para o cliente (WhatsApp).
 *
 * Cada evento do fluxo (cliente cadastrado, medição agendada, datas da
 * assistência, lembrete de véspera...) tem um texto padrão com marcadores que a
 * loja pode editar ou desligar em Configurações. Todo envio fica registrado em
 * MessageLog — inclusive quando o WhatsApp ainda não está configurado (status
 * LOGGED) — e um `dedupeKey` impede mandar a mesma mensagem duas vezes.
 *
 * Nunca lança: falha de canal não pode quebrar o fluxo que disparou a mensagem.
 */
import type { MessageEvent, MessageStatus } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { firstName, renderTemplate, templateKeys } from "../utils/template";
import { sendWhatsAppTemplate, sendWhatsAppText, toWhatsAppNumber } from "./whatsapp";

export type AutomationDef = {
  label: string;
  description: string;
  body: string;
  /** Marcadores disponíveis para este evento. */
  vars: string[];
  delayDays?: number;
};

const COMMON = ["cliente.nome", "cliente.primeiroNome", "empresa.nome", "portal.link"];

export const AUTOMATION_DEFAULTS: Record<MessageEvent, AutomationDef> = {
  CLIENT_WELCOME: {
    label: "Boas-vindas ao cliente",
    description: "Quando um cliente é cadastrado.",
    body: "Olá, {{cliente.primeiroNome}}! Aqui é da {{empresa.nome}}. Seu cadastro foi feito e a partir de agora vamos te avisar por aqui sobre cada etapa do seu projeto. Qualquer dúvida, é só responder esta mensagem.",
    vars: COMMON,
  },
  LEAD_RECEIVED: {
    label: "Contato recebido (briefing)",
    description: "Quando alguém preenche o briefing no site.",
    body: "Olá, {{cliente.primeiroNome}}! Recebemos suas informações na {{empresa.nome}}. Um consultor vai falar com você em breve para entender melhor o seu projeto.",
    vars: COMMON,
  },
  PORTAL_ACCESS: {
    label: "Acesso ao portal liberado",
    description: "Quando o portal completo é liberado (convite ou cadastro completado pela equipe).",
    body: "{{cliente.primeiroNome}}, seu acesso completo ao portal da {{empresa.nome}} foi liberado: {{portal.link}}. Por lá você acompanha medição, projeto, produção e assistência.",
    vars: COMMON,
  },
  MEASUREMENT_SCHEDULED: {
    label: "Medição agendada",
    description: "Quando a equipe confirma a data da medição.",
    body: "Sua medição do projeto {{projeto.codigo}} foi agendada para {{medicao.data}}. — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "projeto.nome", "medicao.data"],
  },
  TECH_APPROVAL_READY: {
    label: "Projeto técnico disponível",
    description: "Quando o projeto técnico é publicado para aprovação.",
    body: "O projeto técnico do contrato {{projeto.codigo}} está disponível no portal para sua revisão e aprovação: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "projeto.nome"],
  },
  PRODUCTION_STAGE: {
    label: "Etapa da produção",
    description: "Quando o pedido avança de etapa na fábrica.",
    body: "Atualização do seu projeto {{projeto.codigo}}: etapa \"{{producao.etapa}}\". — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "projeto.nome", "producao.etapa"],
  },
  ASSISTANCE_RECEIVED: {
    label: "Assistência recebida",
    description: "Quando o cliente abre um chamado de assistência.",
    body: "Recebemos seu chamado de assistência {{assistencia.numero}}. Em breve enviamos as datas disponíveis para a visita. — {{empresa.nome}}",
    vars: [...COMMON, "assistencia.numero", "assistencia.titulo"],
  },
  ASSISTANCE_OPTIONS: {
    label: "Datas da assistência",
    description: "Quando a gestão propõe as datas possíveis para a visita.",
    body: "{{cliente.primeiroNome}}, separamos estas datas para a visita de assistência {{assistencia.numero}}:\n{{assistencia.datas}}\nEscolha a melhor pelo portal: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "assistencia.numero", "assistencia.titulo", "assistencia.datas"],
  },
  ASSISTANCE_SCHEDULED: {
    label: "Assistência agendada",
    description: "Quando o cliente escolhe a data da visita.",
    body: "Visita de assistência {{assistencia.numero}} marcada para {{assistencia.data}}. Um dia antes enviamos um lembrete para confirmar. — {{empresa.nome}}",
    vars: [...COMMON, "assistencia.numero", "assistencia.data"],
  },
  ASSISTANCE_REMINDER: {
    label: "Lembrete de véspera da assistência",
    description: "Enviado no dia anterior à visita, pedindo confirmação.",
    body: "Lembrete: amanhã ({{assistencia.data}}) temos a visita de assistência {{assistencia.numero}}. Confirme aqui: {{assistencia.linkConfirmacao}} — ou responda CONFIRMAR. Se precisar remarcar, responda REMARCAR. — {{empresa.nome}}",
    vars: [...COMMON, "assistencia.numero", "assistencia.data", "assistencia.linkConfirmacao"],
  },
  POST_SALE_FOLLOWUP: {
    label: "Pós-venda",
    description: "Alguns dias depois da entrega, para saber como ficou.",
    body: "Olá, {{cliente.primeiroNome}}! Faz alguns dias que entregamos o projeto {{projeto.codigo}}. Está tudo certo com os móveis? Se precisar de algo, abra uma assistência pelo portal: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "projeto.nome"],
    delayDays: 7,
  },
  PAYMENT_REMINDER: {
    label: "Parcela vence em breve",
    description: "3 dias antes do vencimento de uma parcela.",
    body: "Olá, {{cliente.primeiroNome}}! Passando para lembrar que a parcela de {{parcela.valor}} do projeto {{projeto.codigo}} vence em {{parcela.vencimento}}. Se já pagou, pode desconsiderar — e, se quiser, envie o comprovante pelo portal: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "parcela.valor", "parcela.vencimento"],
  },
  PAYMENT_DUE_TODAY: {
    label: "Parcela vence hoje",
    description: "No dia do vencimento.",
    body: "Olá, {{cliente.primeiroNome}}! A parcela de {{parcela.valor}} do projeto {{projeto.codigo}} vence hoje. O comprovante pode ser enviado pelo portal: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "parcela.valor", "parcela.vencimento"],
  },
  PAYMENT_OVERDUE: {
    label: "Parcela em atraso",
    description: "Um dia depois do vencimento, sem pagamento registrado.",
    // tom de lembrete, não de cobrança: pode ser só atraso na baixa
    body: "Olá, {{cliente.primeiroNome}}. Não localizamos ainda o pagamento da parcela de {{parcela.valor}} do projeto {{projeto.codigo}}, com vencimento em {{parcela.vencimento}}. Se já pagou, é só enviar o comprovante pelo portal que a gente confere: {{portal.link}}. Qualquer dúvida, estamos à disposição. — {{empresa.nome}}",
    vars: [...COMMON, "projeto.codigo", "parcela.valor", "parcela.vencimento"],
  },
  RECEIPT_AVAILABLE: {
    label: "Recibo disponível",
    description: "Quando o financeiro confirma um pagamento e o recibo é emitido.",
    body: "Recebemos seu pagamento de {{recibo.valor}}, {{cliente.primeiroNome}}. Obrigado! O recibo {{recibo.numero}} já está no portal: {{portal.link}} — {{empresa.nome}}",
    vars: [...COMMON, "recibo.numero", "recibo.valor"],
  },
};

export const MESSAGE_EVENTS = Object.keys(AUTOMATION_DEFAULTS) as MessageEvent[];

/** Configuração efetiva (o que a loja salvou, senão o padrão). */
export async function getAutomation(organizationId: string, event: MessageEvent) {
  const row = await prisma.messageAutomation.findUnique({ where: { organizationId_event: { organizationId, event } } });
  const def = AUTOMATION_DEFAULTS[event];
  return {
    event,
    label: def.label,
    description: def.description,
    vars: def.vars,
    enabled: row?.enabled ?? true,
    body: row?.body ?? def.body,
    metaTemplateName: row?.metaTemplateName ?? null,
    delayDays: row?.delayDays ?? def.delayDays ?? 0,
    customized: Boolean(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

async function baseVars(organizationId: string, clientName: string | null) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, enterprise: { select: { tradeName: true, legalName: true } } },
  });
  return {
    "cliente.nome": clientName ?? "",
    "cliente.primeiroNome": firstName(clientName),
    "empresa.nome": org?.enterprise.tradeName || org?.enterprise.legalName || org?.name || "MOBIEER",
    "portal.link": `${env.appUrl}${env.portal.path}`,
  };
}

export type SendAutomationInput = {
  organizationId: string;
  clientId?: string | null;
  leadId?: string | null;
  /** Telefone direto (lead sem cliente). Se vier clientId, usa o do cliente. */
  phone?: string | null;
  name?: string | null;
  vars?: Record<string, string>;
  /** Mesma chave = não reenvia. Ex.: `assistance-reminder:<ticketId>:<data>`. */
  dedupeKey?: string;
};

export type SendAutomationResult = { status: MessageStatus; logId?: string; reason?: string };

/**
 * Parâmetros do template da Meta: os valores dos marcadores na ordem em que
 * aparecem no texto ({{1}}, {{2}}, ...).
 */
export function templateParams(body: string, values: Record<string, string>) {
  return templateKeys(body).map((k) => values[k] ?? "");
}

export async function sendAutomation(event: MessageEvent, input: SendAutomationInput): Promise<SendAutomationResult> {
  try {
    const cfg = await getAutomation(input.organizationId, event);

    let phone = input.phone ?? null;
    let name = input.name ?? null;
    if (input.clientId) {
      const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { name: true, phone: true } });
      phone = client?.phone ?? phone;
      name = client?.name ?? name;
    }

    const values = { ...(await baseVars(input.organizationId, name)), ...(input.vars ?? {}) };
    const { text } = renderTemplate(cfg.body, values);
    const to = toWhatsAppNumber(phone);

    const log = async (status: MessageStatus, extra: { error?: string; providerMessageId?: string } = {}) => {
      try {
        const row = await prisma.messageLog.create({
          data: {
            organizationId: input.organizationId,
            event,
            clientId: input.clientId ?? null,
            leadId: input.leadId ?? null,
            to,
            body: text,
            status,
            error: extra.error ?? null,
            providerMessageId: extra.providerMessageId ?? null,
            // só "ocupa" a chave quando a mensagem saiu (ou foi logada); falha pode tentar de novo
            dedupeKey: status === "SENT" || status === "LOGGED" ? input.dedupeKey ?? null : null,
          },
        });
        return row.id;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") return undefined; // corrida: outro envio já registrou
        throw e;
      }
    };

    if (input.dedupeKey) {
      const already = await prisma.messageLog.findFirst({
        where: { organizationId: input.organizationId, dedupeKey: input.dedupeKey },
        select: { id: true },
      });
      if (already) return { status: "SKIPPED", reason: "já enviada" };
    }

    if (!cfg.enabled) return { status: "SKIPPED", reason: "automação desligada", logId: await log("SKIPPED", { error: "automação desligada" }) };
    if (!to) return { status: "SKIPPED", reason: "sem telefone válido", logId: await log("SKIPPED", { error: "sem telefone válido" }) };

    const result = cfg.metaTemplateName
      ? await sendWhatsAppTemplate(to, cfg.metaTemplateName, templateParams(cfg.body, values))
      : await sendWhatsAppText(to, text);

    if (result.delivered) return { status: "SENT", logId: await log("SENT", { providerMessageId: result.id }) };
    if (result.skipped) return { status: "LOGGED", logId: await log("LOGGED") };
    return { status: "FAILED", reason: result.error, logId: await log("FAILED", { error: result.error }) };
  } catch (e) {
    console.error(`[automations] ${event} falhou:`, e instanceof Error ? e.message : e);
    return { status: "FAILED", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Data/hora em Fortaleza no formato das mensagens: "18/09 (quinta) às 09:00". */
export function fmtVisit(d: Date, period?: string | null) {
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit" });
  const weekday = d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza", weekday: "long" }).replace("-feira", "");
  const periodLabel = period === "MANHA" ? "pela manhã" : period === "TARDE" ? "à tarde" : null;
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
  return `${day} (${weekday}) ${periodLabel ?? `às ${time}`}`;
}
