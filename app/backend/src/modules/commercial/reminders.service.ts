/**
 * Lembretes do comercial e meta sugerida: busca os dados e entrega às regras
 * (reminders.rules.ts e goal-suggestion.rules.ts).
 */
import { prisma } from "../../prisma";
import { classifyDreLine } from "../finance/dre.service";
import { addMonthKey } from "../finance/recurring.rules";
import { FIXED_LINES } from "../store/store.service";
import { marginFromMarkup, suggestGoal } from "./goal-suggestion.rules";
import { monthRange } from "./goals.service";
import { loadPricing } from "./quote.service";
import { buildReminders, digest, type Reminder, type ReminderData } from "./reminders.rules";

const DAY = 86_400_000;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const person = { select: { id: true, name: true } } as const;

/** Tudo que está em aberto no comercial. `sellerId` restringe à carteira de um vendedor. */
export async function loadReminderData(scope: { organizationId?: string; sellerId?: string | null }): Promise<ReminderData> {
  const org = scope.organizationId ? { organizationId: scope.organizationId } : {};
  const mine = scope.sellerId ? { sellerId: scope.sellerId } : {};

  const [opps, quotes, leads] = await Promise.all([
    prisma.commercialOpportunity.findMany({
      where: { ...org, ...mine, status: { notIn: ["WON", "LOST"] } },
      select: {
        id: true, title: true, createdAt: true, nextAction: true, nextActionAt: true,
        client: { select: { name: true } },
        lead: { select: { name: true } },
        seller: person,
        interactions: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 1 },
      },
    }),
    prisma.commercialQuote.findMany({
      // só a versão mais recente de cada orçamento
      where: { ...org, ...mine, kind: "PADRAO", status: { in: ["DRAFT", "SENT", "VIEWED", "NEGOTIATION"] }, versions: { none: { kind: "PADRAO" } } },
      select: { id: true, number: true, version: true, status: true, total: true, createdAt: true, sentAt: true, updatedAt: true, validUntil: true, client: { select: { name: true } }, seller: person },
    }),
    prisma.commercialLead.findMany({
      where: { ...org, ...mine, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
      select: { id: true, name: true, enteredAt: true, lastContactAt: true, nextContactAt: true, seller: person },
    }),
  ]);

  return {
    opportunities: opps.map((o) => ({
      id: o.id, title: o.title, createdAt: o.createdAt, nextAction: o.nextAction, nextActionAt: o.nextActionAt,
      lastInteractionAt: o.interactions[0]?.occurredAt ?? null,
      client: o.client?.name ?? o.lead?.name ?? null,
      seller: o.seller,
    })),
    quotes: quotes.map((q) => ({ ...q, total: n(q.total), client: q.client.name })),
    leads,
  };
}

export const REMINDER_TITLE = "Clientes em aberto";

/**
 * Job diário: cada vendedor recebe no sino o resumo dos clientes em aberto que
 * precisam de contato (ações vencidas, orçamentos sem retorno ou vencendo,
 * leads sem contato). Um aviso por dia.
 */
export async function runCommercialReminders(now = new Date()) {
  const reminders = buildReminders(await loadReminderData({}), now);
  const bySeller = new Map<string, Reminder[]>();
  for (const r of reminders) {
    if (!r.sellerId) continue;
    bySeller.set(r.sellerId, [...(bySeller.get(r.sellerId) ?? []), r]);
  }

  let created = 0;
  for (const [sellerId, items] of bySeller) {
    const recent = await prisma.notification.findFirst({
      where: { userId: sellerId, title: REMINDER_TITLE, createdAt: { gte: new Date(now.getTime() - 20 * 3_600_000) } },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.notification.create({ data: { type: "INFO", title: REMINDER_TITLE, message: digest(items), userId: sellerId, link: "/comercial?aba=lembretes" } });
    created++;
  }
  return { sellersNotified: created, reminders: reminders.length };
}

/** Despesas fixas do mês: os modelos em Financeiro → Fixos; sem eles, a média paga dos 3 meses anteriores. */
async function fixedCostsFor(organizationId: string, month: string) {
  const recurring = await prisma.financeRecurring.findMany({
    where: { organizationId, active: true, type: "DESPESA", startMonth: { lte: month }, OR: [{ endMonth: null }, { endMonth: { gte: month } }] },
    select: { description: true, category: true, amount: true },
    orderBy: { amount: "desc" },
  });
  if (recurring.length) {
    return {
      source: "FIXOS" as const,
      total: recurring.reduce((s, r) => s + n(r.amount), 0),
      items: recurring.map((r) => ({ description: r.description, category: r.category, amount: n(r.amount) })),
    };
  }

  const { from: to } = monthRange(month);
  const { from } = monthRange(addMonthKey(month, -3));
  const [paid, mappings] = await Promise.all([
    prisma.financeTransaction.findMany({ where: { organizationId, type: "DESPESA", status: "PAGO", date: { gte: from, lt: to } }, select: { category: true, amount: true, date: true } }),
    prisma.dreCategoryMapping.findMany({ where: { organizationId }, select: { category: true, dreLine: true } }),
  ]);
  const map = new Map(mappings.map((m) => [m.category, m.dreLine]));
  const byCategory = new Map<string, number>();
  const monthsSeen = new Set<string>();
  for (const t of paid) {
    const line = map.get(t.category) ?? classifyDreLine("DESPESA", t.category);
    if (!(FIXED_LINES as readonly string[]).includes(line)) continue;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + n(t.amount));
    monthsSeen.add(t.date.toISOString().slice(0, 7));
  }
  const months = Math.max(1, monthsSeen.size);
  const items = [...byCategory.entries()].map(([category, v]) => ({ description: category, category, amount: Math.round((v / months) * 100) / 100 })).sort((a, b) => b.amount - a.amount);
  return { source: "HISTORICO" as const, total: items.reduce((s, i) => s + i.amount, 0), items };
}

/** Meta sugerida para o mês a partir das despesas fixas. */
export async function goalSuggestion(organizationId: string, month: string, profitPercent: number, now = new Date()) {
  const since = new Date(now.getTime() - 180 * DAY);
  const [fixed, pricing, accepted, sales, sellers] = await Promise.all([
    fixedCostsFor(organizationId, month),
    loadPricing(),
    prisma.commercialQuote.findMany({
      where: { organizationId, status: "APPROVED", approvedAt: { gte: since }, costTotal: { gt: 0 } },
      select: { total: true, result: true },
    }),
    prisma.sale.findMany({ where: { organizationId, soldAt: { gte: since } }, select: { value: true, sellerId: true } }),
    prisma.user.findMany({
      where: { organizationId, status: "ACTIVE", OR: [{ commercialSales: { some: { soldAt: { gte: since } } } }, { assignedOpportunities: { some: { status: { notIn: ["WON", "LOST"] } } } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // margem: o que sobrou de verdade nos contratos aceitos; sem histórico, a da precificação padrão
  const acceptedTotal = accepted.reduce((s, q) => s + n(q.total), 0);
  const acceptedResult = accepted.reduce((s, q) => s + n(q.result), 0);
  const realMargin = accepted.length >= 3 && acceptedTotal > 0 ? (acceptedResult / acceptedTotal) * 100 : null;
  const defaultCommission = pricing.commissionRoles.reduce((s, r) => s + r.defaultPercent, 0);
  const margin =
    realMargin != null && realMargin > 0
      ? { percent: realMargin, source: "CONTRATOS" as const, sample: accepted.length }
      : { percent: marginFromMarkup(pricing.defaultMarkup, defaultCommission), source: "PRECIFICACAO" as const, sample: accepted.length };

  const soldBy = new Map<string, number>();
  for (const s of sales) soldBy.set(s.sellerId, (soldBy.get(s.sellerId) ?? 0) + n(s.value));
  const soldTotal = sales.reduce((s, v) => s + n(v.value), 0);
  const avgTicket = sales.length ? soldTotal / sales.length : accepted.length ? acceptedTotal / accepted.length : null;

  const suggestion = suggestGoal({
    fixedCosts: fixed.total,
    marginPercent: margin.percent,
    profitPercent,
    avgTicket,
    sellers: sellers.map((u) => ({ id: u.id, name: u.name, sold: soldBy.get(u.id) ?? 0 })),
  });

  return {
    month,
    suggestion,
    fixed: { source: fixed.source, total: Math.round(fixed.total * 100) / 100, items: fixed.items.slice(0, 12), count: fixed.items.length },
    margin: { percent: Math.round(margin.percent * 100) / 100, source: margin.source, sample: margin.sample, markup: pricing.defaultMarkup, commissionPercent: defaultCommission },
    ticket: { value: avgTicket ? Math.round(avgTicket * 100) / 100 : null, sample: sales.length || accepted.length },
  };
}
