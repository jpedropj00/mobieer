/**
 * Assistência (pós-venda) agendada com o cliente:
 *
 *   cliente abre o chamado (portal)
 *   -> gestão recebe e devolve uma lista de datas possíveis
 *   -> cliente escolhe uma data no portal
 *   -> na véspera, o cliente recebe no WhatsApp o pedido de confirmação
 *      (link sem login ou resposta CONFIRMAR / REMARCAR)
 *   -> visita confirmada; se pedir para remarcar, volta para a gestão.
 */
import crypto from "crypto";
import type { AssistanceTicket } from "@prisma/client";
import { env } from "../../config/env";
import { fmtVisit, sendAutomation } from "../../lib/automations";
import { notifyUsersWithPermission } from "../../lib/notify";
import { prisma } from "../../prisma";
import { InvalidStateError, NotFoundError, ValidationError } from "../../utils/ApiError";

export const VISIT_PERIODS = ["MANHA", "TARDE", "QUALQUER"] as const;
export type VisitPeriod = (typeof VISIT_PERIODS)[number];
export const MAX_VISIT_OPTIONS = 6;
const FORTALEZA_TZ = "America/Fortaleza";
const DAY_MS = 86400000;

/** Dia local de Fortaleza (aaaa-mm-dd). */
export const fortalezaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: FORTALEZA_TZ });

// ---------------- pedido de assistência (só o cliente abre) ----------------

export const ASSISTANCE_PROBLEM_TYPES = [
  "Porta desalinhada",
  "Dobradiça",
  "Gaveta / corrediça",
  "Puxador",
  "Acabamento / fita de borda",
  "Peça danificada",
  "Peça faltando",
  "Umidade / estufamento",
  "Iluminação / elétrica",
  "Outro",
] as const;

export const MIN_ASSISTANCE_PHOTOS = 1;
/** Fotos no pedido inicial (cada uma comprimida no app para caber no limite do servidor). */
export const MAX_ASSISTANCE_PHOTOS_ON_OPEN = 6;
export const MIN_ASSISTANCE_DESCRIPTION = 20;

export type AssistanceRequestInput = {
  problemType: string;
  roomLabel: string;
  description: string;
  photoCount: number;
  projectId: string | null;
  clientHasProjects: boolean;
};

/** Valida o pedido do cliente e monta o título. (pura, para testes) */
export function validateAssistanceRequest(i: AssistanceRequestInput) {
  if (!(ASSISTANCE_PROBLEM_TYPES as readonly string[]).includes(i.problemType)) {
    throw new ValidationError("Escolha o tipo do problema", { field: "problemType" });
  }
  const room = i.roomLabel.trim();
  if (room.length < 2) throw new ValidationError("Informe em qual ambiente está o problema", { field: "roomLabel" });
  const description = i.description.trim();
  if (description.length < MIN_ASSISTANCE_DESCRIPTION) {
    throw new ValidationError(
      `Descreva o problema com mais detalhes (mínimo de ${MIN_ASSISTANCE_DESCRIPTION} caracteres): o que aconteceu, desde quando e onde exatamente`,
      { field: "description" }
    );
  }
  if (i.photoCount < MIN_ASSISTANCE_PHOTOS) {
    throw new ValidationError("Envie pelo menos uma foto do problema", { field: "photos" });
  }
  if (i.photoCount > MAX_ASSISTANCE_PHOTOS_ON_OPEN) {
    throw new ValidationError(`Envie até ${MAX_ASSISTANCE_PHOTOS_ON_OPEN} fotos no pedido; dá para anexar mais depois`, { field: "photos" });
  }
  if (i.clientHasProjects && !i.projectId) {
    throw new ValidationError("Escolha o projeto em que está o problema", { field: "projectId" });
  }
  return { title: `${i.problemType} — ${room}`.slice(0, 255), roomLabel: room, description };
}

// ---------------- regras puras (testáveis) ----------------

export type VisitOptionInput = { startsAt: Date; period?: VisitPeriod | null };

/**
 * Valida as datas propostas: 1 a 6, todas no futuro (com folga de 1h), sem
 * repetir o mesmo dia+período. Devolve ordenado.
 */
export function validateVisitOptions(options: VisitOptionInput[], now = new Date()): VisitOptionInput[] {
  if (!options.length) throw new ValidationError("Informe pelo menos uma data para a visita");
  if (options.length > MAX_VISIT_OPTIONS) throw new ValidationError(`Informe no máximo ${MAX_VISIT_OPTIONS} datas`);
  const seen = new Set<string>();
  for (const o of options) {
    if (Number.isNaN(o.startsAt.getTime())) throw new ValidationError("Data inválida na lista");
    if (o.startsAt.getTime() < now.getTime() + 60 * 60 * 1000) {
      throw new ValidationError(`A data ${fmtVisit(o.startsAt, o.period)} já passou ou está muito próxima`);
    }
    const key = `${fortalezaDay(o.startsAt)}|${o.period ?? o.startsAt.toISOString()}`;
    if (seen.has(key)) throw new ValidationError(`Data repetida: ${fmtVisit(o.startsAt, o.period)}`);
    seen.add(key);
  }
  return [...options].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** A visita é amanhã (no calendário de Fortaleza)? */
export function isTomorrowInFortaleza(visit: Date, now = new Date()) {
  return fortalezaDay(visit) === fortalezaDay(new Date(now.getTime() + DAY_MS));
}

export type ClientReply = "CONFIRM" | "RESCHEDULE" | null;

/** Interpreta a resposta do cliente no WhatsApp (texto livre ou botão). */
export function parseClientReply(text: string | null | undefined): ClientReply {
  const t = (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!t) return null;
  if (/\b(remarcar|reagendar|outra data|nao posso|nao vou poder|cancelar|desmarcar)\b/.test(t)) return "RESCHEDULE";
  if (t.startsWith("\u{1F44D}") || /^(sim|ok|confirmo|confirmado|confirmar|confirma|pode vir|pode ser|combinado|certo|beleza)\b/.test(t) || /\bconfirm/.test(t)) {
    return "CONFIRM";
  }
  return null;
}

// ---------------- operações ----------------

export const scheduleSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  organizationId: true,
  clientId: true,
  assigneeId: true,
  scheduledAt: true,
  schedulePeriod: true,
  optionsSentAt: true,
  clientConfirmedAt: true,
  reminderSentAt: true,
  rescheduleRequestedAt: true,
  visitOptions: { orderBy: { startsAt: "asc" as const } },
} as const;

type ScheduleRow = Pick<
  AssistanceTicket,
  | "id"
  | "number"
  | "status"
  | "scheduledAt"
  | "schedulePeriod"
  | "optionsSentAt"
  | "clientConfirmedAt"
  | "reminderSentAt"
  | "rescheduleRequestedAt"
> & { visitOptions: { id: string; startsAt: Date; period: string | null; chosenAt: Date | null }[] };

/** Estado do agendamento para as telas (equipe e portal). */
export function serializeSchedule(t: ScheduleRow) {
  const pending = t.visitOptions.filter((o) => !o.chosenAt);
  let stage: "SEM_DATAS" | "AGUARDANDO_CLIENTE" | "AGENDADA" | "CONFIRMADA" | "REMARCAR";
  if (t.rescheduleRequestedAt && !t.scheduledAt) stage = "REMARCAR";
  else if (t.scheduledAt && t.clientConfirmedAt) stage = "CONFIRMADA";
  else if (t.scheduledAt) stage = "AGENDADA";
  else if (pending.length) stage = "AGUARDANDO_CLIENTE";
  else stage = "SEM_DATAS";

  return {
    stage,
    scheduledAt: t.scheduledAt,
    schedulePeriod: t.schedulePeriod,
    scheduledLabel: t.scheduledAt ? fmtVisit(t.scheduledAt, t.schedulePeriod) : null,
    optionsSentAt: t.optionsSentAt,
    clientConfirmedAt: t.clientConfirmedAt,
    reminderSentAt: t.reminderSentAt,
    rescheduleRequestedAt: t.rescheduleRequestedAt,
    options: t.visitOptions.map((o) => ({
      id: o.id,
      startsAt: o.startsAt,
      period: o.period,
      label: fmtVisit(o.startsAt, o.period),
      chosen: Boolean(o.chosenAt),
    })),
  };
}

async function loadTicket(where: { id: string; organizationId?: string; clientId?: string }) {
  const t = await prisma.assistanceTicket.findFirst({ where, select: { ...scheduleSelect, client: { select: { name: true } } } });
  if (!t) throw new NotFoundError("Chamado de assistência não encontrado");
  return t;
}

const CLOSED = new Set(["RESOLVED", "CANCELLED"]);
function assertOpen(t: { status: string }) {
  if (CLOSED.has(t.status)) throw new InvalidStateError("Este chamado já foi encerrado");
}

/** Gestão propõe as datas possíveis. Substitui as opções anteriores não escolhidas. */
export async function proposeVisitOptions(opts: {
  ticketId: string;
  organizationId: string;
  userId: string;
  options: VisitOptionInput[];
  now?: Date;
}) {
  const t = await loadTicket({ id: opts.ticketId, organizationId: opts.organizationId });
  assertOpen(t);
  const options = validateVisitOptions(opts.options, opts.now);
  const now = new Date();

  await prisma.$transaction([
    prisma.assistanceVisitOption.deleteMany({ where: { ticketId: t.id } }),
    prisma.assistanceVisitOption.createMany({
      data: options.map((o) => ({ ticketId: t.id, startsAt: o.startsAt, period: o.period ?? null, createdById: opts.userId })),
    }),
    prisma.assistanceTicket.update({
      where: { id: t.id },
      data: {
        status: "WAITING_CLIENT",
        optionsSentAt: now,
        scheduledAt: null,
        schedulePeriod: null,
        clientConfirmedAt: null,
        reminderSentAt: null,
        confirmToken: null,
        rescheduleRequestedAt: null,
      },
    }),
  ]);

  await sendAutomation("ASSISTANCE_OPTIONS", {
    organizationId: t.organizationId,
    clientId: t.clientId,
    vars: {
      "assistencia.numero": t.number,
      "assistencia.titulo": t.title,
      "assistencia.datas": options.map((o) => `• ${fmtVisit(o.startsAt, o.period)}`).join("\n"),
    },
    dedupeKey: `assistance-options:${t.id}:${now.getTime()}`,
  });
  return loadTicket({ id: t.id });
}

/** Cliente escolhe uma das datas (portal) — ou a equipe marca direto (telefone). */
export async function scheduleVisit(opts: {
  ticketId: string;
  scope: { organizationId?: string; clientId?: string };
  optionId?: string;
  direct?: VisitOptionInput;
  actor: { kind: "CLIENT" } | { kind: "STAFF"; userId: string };
}) {
  const t = await loadTicket({ id: opts.ticketId, ...opts.scope });
  assertOpen(t);

  let startsAt: Date;
  let period: string | null;
  if (opts.optionId) {
    const option = t.visitOptions.find((o) => o.id === opts.optionId);
    if (!option) throw new NotFoundError("Data não encontrada para este chamado");
    if (option.startsAt.getTime() < Date.now()) throw new InvalidStateError("Esta data já passou — peça novas datas à equipe");
    startsAt = option.startsAt;
    period = option.period;
    await prisma.assistanceVisitOption.updateMany({ where: { ticketId: t.id }, data: { chosenAt: null } });
    await prisma.assistanceVisitOption.update({ where: { id: option.id }, data: { chosenAt: new Date() } });
  } else if (opts.direct) {
    const [v] = validateVisitOptions([opts.direct]);
    startsAt = v.startsAt;
    period = v.period ?? null;
  } else {
    throw new ValidationError("Escolha uma data");
  }

  await prisma.assistanceTicket.update({
    where: { id: t.id },
    data: {
      status: "SCHEDULED",
      scheduledAt: startsAt,
      schedulePeriod: period,
      clientConfirmedAt: null,
      reminderSentAt: null,
      rescheduleRequestedAt: null,
      confirmToken: crypto.randomBytes(24).toString("base64url"),
    },
  });

  const label = fmtVisit(startsAt, period);
  if (opts.actor.kind === "CLIENT") {
    await notifyUsersWithPermission({
      organizationId: t.organizationId,
      permission: "organization.tasks.edit.all",
      title: "Assistência agendada pelo cliente",
      message: `${t.number} — ${t.client.name} escolheu ${label}.`,
      extraUserIds: [t.assigneeId],
    });
  }
  await sendAutomation("ASSISTANCE_SCHEDULED", {
    organizationId: t.organizationId,
    clientId: t.clientId,
    vars: { "assistencia.numero": t.number, "assistencia.data": label },
    dedupeKey: `assistance-scheduled:${t.id}:${startsAt.toISOString()}`,
  });
  return loadTicket({ id: t.id });
}

/** Cliente confirma a visita (portal, link do WhatsApp ou resposta CONFIRMAR). */
export async function confirmVisit(ticketId: string, via: "PORTAL" | "LINK" | "WHATSAPP" | "EQUIPE") {
  const t = await loadTicket({ id: ticketId });
  assertOpen(t);
  if (!t.scheduledAt) throw new InvalidStateError("Esta visita ainda não tem data marcada");
  if (t.clientConfirmedAt) return loadTicket({ id: t.id });

  await prisma.assistanceTicket.update({ where: { id: t.id }, data: { clientConfirmedAt: new Date() } });
  await notifyUsersWithPermission({
    organizationId: t.organizationId,
    permission: "organization.tasks.edit.all",
    title: "Visita de assistência confirmada",
    message: `${t.number} — ${t.client.name} confirmou ${fmtVisit(t.scheduledAt, t.schedulePeriod)} (${via.toLowerCase()}).`,
    extraUserIds: [t.assigneeId],
  });
  return loadTicket({ id: t.id });
}

/** Cliente pede outra data: a gestão precisa propor de novo. */
export async function requestReschedule(ticketId: string, via: "PORTAL" | "LINK" | "WHATSAPP", reason?: string | null) {
  const t = await loadTicket({ id: ticketId });
  assertOpen(t);
  const previous = t.scheduledAt ? fmtVisit(t.scheduledAt, t.schedulePeriod) : null;

  await prisma.$transaction([
    prisma.assistanceVisitOption.deleteMany({ where: { ticketId: t.id } }),
    prisma.assistanceTicket.update({
      where: { id: t.id },
      data: {
        status: "TRIAGE",
        scheduledAt: null,
        schedulePeriod: null,
        clientConfirmedAt: null,
        reminderSentAt: null,
        confirmToken: null,
        rescheduleRequestedAt: new Date(),
      },
    }),
  ]);

  await notifyUsersWithPermission({
    organizationId: t.organizationId,
    permission: "organization.tasks.edit.all",
    title: "Cliente pediu para remarcar a assistência",
    message: `${t.number} — ${t.client.name}${previous ? ` (era ${previous})` : ""} pediu nova data via ${via.toLowerCase()}.${reason ? ` Motivo: ${reason}` : ""} Envie novas opções.`,
    extraUserIds: [t.assigneeId],
  });
  return loadTicket({ id: t.id });
}

/** Link de confirmação sem login enviado no lembrete. */
export const confirmLink = (token: string) => `${env.appUrl}/confirmar-visita/${token}`;

/**
 * Job diário (manhã): lembrete de véspera para o cliente confirmar, e aviso à
 * equipe das visitas de hoje que o cliente não confirmou.
 */
export async function runAssistanceReminders(now = new Date()) {
  const from = new Date(now.getTime() - DAY_MS);
  const to = new Date(now.getTime() + 2 * DAY_MS);
  const tickets = await prisma.assistanceTicket.findMany({
    where: { status: "SCHEDULED", scheduledAt: { gte: from, lte: to } },
    select: { ...scheduleSelect, confirmToken: true, client: { select: { name: true } } },
  });

  let reminders = 0;
  let unconfirmedToday = 0;
  for (const t of tickets) {
    if (!t.scheduledAt) continue;

    if (isTomorrowInFortaleza(t.scheduledAt, now) && !t.reminderSentAt && !t.clientConfirmedAt) {
      let token = t.confirmToken;
      if (!token) {
        token = crypto.randomBytes(24).toString("base64url");
        await prisma.assistanceTicket.update({ where: { id: t.id }, data: { confirmToken: token } });
      }
      const r = await sendAutomation("ASSISTANCE_REMINDER", {
        organizationId: t.organizationId,
        clientId: t.clientId,
        vars: {
          "assistencia.numero": t.number,
          "assistencia.data": fmtVisit(t.scheduledAt, t.schedulePeriod),
          "assistencia.linkConfirmacao": confirmLink(token),
        },
        dedupeKey: `assistance-reminder:${t.id}:${fortalezaDay(t.scheduledAt)}`,
      });
      if (r.status !== "FAILED") {
        await prisma.assistanceTicket.update({ where: { id: t.id }, data: { reminderSentAt: now } });
        reminders++;
      }
    }

    if (fortalezaDay(t.scheduledAt) === fortalezaDay(now) && !t.clientConfirmedAt) {
      const already = await prisma.notification.findFirst({
        where: { title: "Visita de hoje sem confirmação", message: { contains: t.number }, createdAt: { gte: new Date(now.getTime() - DAY_MS / 2) } },
        select: { id: true },
      });
      if (!already) {
        await notifyUsersWithPermission({
          organizationId: t.organizationId,
          permission: "organization.tasks.edit.all",
          title: "Visita de hoje sem confirmação",
          message: `${t.number} — ${t.client.name}: visita ${fmtVisit(t.scheduledAt, t.schedulePeriod)} ainda não foi confirmada pelo cliente. Vale ligar antes de sair.`,
          extraUserIds: [t.assigneeId],
        });
        unconfirmedToday++;
      }
    }
  }
  return { reminders, unconfirmedToday };
}

/** Novo chamado aberto pelo cliente: avisa a gestão e responde ao cliente. */
export async function onAssistanceOpenedByClient(ticket: { id: string; number: string; title: string; organizationId: string; clientId: string }) {
  const client = await prisma.client.findUnique({ where: { id: ticket.clientId }, select: { name: true } });
  await notifyUsersWithPermission({
    organizationId: ticket.organizationId,
    permission: "organization.tasks.edit.all",
    title: "Nova assistência aberta pelo cliente",
    message: `${ticket.number} — ${client?.name ?? "Cliente"}: ${ticket.title}. Proponha as datas para a visita.`,
  });
  await sendAutomation("ASSISTANCE_RECEIVED", {
    organizationId: ticket.organizationId,
    clientId: ticket.clientId,
    vars: { "assistencia.numero": ticket.number, "assistencia.titulo": ticket.title },
    dedupeKey: `assistance-received:${ticket.id}`,
  });
}

