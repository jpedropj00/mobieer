/**
 * Busca no banco o que entra na "Semana da Mobieer" e entrega às regras.
 */
import { prisma } from "../../prisma";
import { buildReminders } from "../commercial/reminders.rules";
import { loadReminderData } from "../commercial/reminders.service";
import { buildWeekly, mondayOf, weeklyDigest, type WeeklySnapshot } from "./weekly.rules";

const STAGE_LABEL: Record<string, string> = { RELEASED: "Liberado", IN_PRODUCTION: "Em produção", PRE_ASSEMBLY: "Pré-montagem", OUT_FOR_DELIVERY: "Saiu para entrega" };
const DAY = 86_400_000;

export async function weeklyFor(organizationId: string, weekStart: string, now = new Date()) {
  const from = new Date(`${weekStart}T03:00:00Z`); // segunda 00h em Fortaleza
  const to = new Date(from.getTime() + 7 * DAY);
  const org = { organizationId };

  const [reminderData, approvals, measurements, orders, workOrders, assistance, agenda] = await Promise.all([
    loadReminderData({ organizationId }),
    prisma.commercialQuote.findMany({
      where: { ...org, approvalStatus: "PENDING", status: { notIn: ["CANCELLED", "REJECTED", "EXPIRED"] } },
      select: { id: true, number: true, total: true, client: { select: { name: true } }, seller: { select: { name: true } } },
    }),
    prisma.measurementVisit.findMany({
      where: { ...org, OR: [{ status: "REQUESTED" }, { status: "SCHEDULED", scheduledAt: { lt: to } }] },
      select: { id: true, status: true, scheduledAt: true, clientConfirmedAt: true, technician: { select: { name: true } }, project: { select: { code: true, client: { select: { name: true } } } } },
    }),
    prisma.productionOrder.findMany({
      where: { ...org, stage: { not: "DELIVERED" } },
      select: {
        stage: true,
        estimatedDeliveryAt: true,
        project: { select: { id: true, code: true, status: true, client: { select: { name: true } } } },
        items: { select: { status: true } },
      },
    }),
    prisma.installationWorkOrder.findMany({
      where: { ...org, status: "OPEN", OR: [{ scheduledFor: null }, { scheduledFor: { lt: to } }] },
      select: { id: true, number: true, scheduledFor: true, days: true, contractor: { select: { name: true } }, project: { select: { id: true, code: true, client: { select: { name: true } } } } },
    }),
    prisma.assistanceTicket.findMany({
      where: { ...org, status: { notIn: ["RESOLVED", "CANCELLED"] } },
      select: { id: true, number: true, title: true, status: true, priority: true, scheduledAt: true, clientConfirmedAt: true, dueAt: true, client: { select: { name: true } }, assignee: { select: { name: true } } },
    }),
    prisma.agendaEvent.findMany({
      where: { ...org, startAt: { gte: from, lt: to }, cancelledAt: null },
      select: { id: true, title: true, startAt: true, allDay: true, clientName: true, responsible: { select: { name: true } } },
    }),
  ]);

  const snapshot: WeeklySnapshot = {
    weekStart,
    now,
    followups: buildReminders(reminderData, now).map((r) => ({ kind: r.kind, label: r.label, client: r.client, title: r.title, detail: r.detail, days: r.days, sellerName: r.sellerName, link: r.link, priority: r.priority })),
    approvals: approvals.map((q) => ({ id: q.id, number: q.number, client: q.client.name, seller: q.seller?.name ?? null, total: Number(q.total) })),
    measurements: measurements.map((m) => ({ id: m.id, project: m.project.code, client: m.project.client?.name ?? null, scheduledAt: m.scheduledAt, technician: m.technician?.name ?? null, status: m.status, clientConfirmed: Boolean(m.clientConfirmedAt) })),
    production: orders
      .filter((o) => o.project.status !== "CANCELLED" && o.project.status !== "COMPLETED")
      .map((o) => {
        const valid = o.items.filter((i) => i.status !== "CANCELLED");
        return {
          projectId: o.project.id,
          project: o.project.code,
          client: o.project.client?.name ?? null,
          stage: o.stage,
          stageLabel: STAGE_LABEL[o.stage] ?? o.stage,
          estimatedDeliveryAt: o.estimatedDeliveryAt,
          missing: valid.filter((i) => i.status !== "DONE").length,
          total: valid.length,
        };
      }),
    workOrders: workOrders.map((o) => ({ id: o.id, number: o.number, project: o.project.code, projectId: o.project.id, client: o.project.client?.name ?? null, contractor: o.contractor?.name ?? null, scheduledFor: o.scheduledFor, days: o.days })),
    assistance: assistance.map((a) => ({ id: a.id, number: a.number, title: a.title, client: a.client?.name ?? null, status: a.status, priority: a.priority, scheduledAt: a.scheduledAt, clientConfirmed: Boolean(a.clientConfirmedAt), assignee: a.assignee?.name ?? null, dueAt: a.dueAt })),
    agenda: agenda.map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, allDay: e.allDay, client: e.clientName, responsible: e.responsible?.name ?? null })),
  };
  return buildWeekly(snapshot);
}

export const WEEKLY_TITLE = "Semana da Mobieer";

/**
 * Job diário: na segunda-feira (fuso da loja) avisa no sino quem gerencia a
 * operação que a semana está montada, com o resumo e o link. Uma vez por semana.
 */
export async function runWeeklyBriefing(now = new Date()) {
  const weekday = new Date(`${now.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" })}T12:00:00Z`).getUTCDay();
  if (weekday !== 1) return { skipped: "não é segunda-feira" };
  const weekStart = mondayOf(now);
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let notified = 0;
  for (const o of orgs) {
    const w = await weeklyFor(o.id, weekStart, now);
    const users = await prisma.user.findMany({
      where: { organizationId: o.id, status: "ACTIVE", role: { permissions: { some: { permission: { code: "organization.manage" } } } } },
      select: { id: true },
    });
    for (const u of users) {
      const already = await prisma.notification.findFirst({ where: { userId: u.id, title: WEEKLY_TITLE, createdAt: { gte: new Date(now.getTime() - 3 * DAY) } }, select: { id: true } });
      if (already) continue;
      await prisma.notification.create({ data: { type: "INFO", title: WEEKLY_TITLE, message: weeklyDigest(w), userId: u.id, link: "/semana" } });
      notified++;
    }
  }
  return { notified };
}
