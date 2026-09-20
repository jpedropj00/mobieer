import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { boolQuery, intQuery } from "../../utils/query";
import {
  PIPELINE_LABEL,
  PIPELINE_STAGES,
  PIPELINE_STALE_DAYS,
  type PipelineStage,
  computeBreakEven,
  daysSince,
  deriveProjectStage,
  fortalezaMonthStart,
  fortalezaToday,
  isStale,
  pctChange,
} from "./store.service";

/** /api/store — visão de gestão da loja */
const router = Router();
router.use(authenticate);

const DAY_MS = 86400000;
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================ Pipeline ============================

type Card = {
  id: string;
  kind: "LEAD" | "OPPORTUNITY" | "PROJECT" | "ASSISTANCE";
  stage: PipelineStage;
  title: string;
  subtitle: string | null;
  value: number | null;
  since: Date;
  daysInStage: number;
  stale: boolean;
  owner: string | null;
  link: string;
  badge: string | null;
};

// GET /api/store/pipeline
router.get(
  "/pipeline",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const now = new Date();
    const cards: Card[] = [];
    const push = (c: Omit<Card, "daysInStage" | "stale">) =>
      cards.push({ ...c, daysInStage: daysSince(c.since, now), stale: isStale(c.stage, c.since, now) });

    const [leads, opps, projects, tickets] = await Promise.all([
      prisma.commercialLead.findMany({
        where: { organizationId, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
        select: { id: true, name: true, status: true, enteredAt: true, lastContactAt: true, interest: true, seller: { select: { name: true } } },
      }),
      prisma.commercialOpportunity.findMany({
        where: { organizationId, status: { in: ["OPEN", "NEGOTIATION", "WAITING_CLIENT"] } },
        select: {
          id: true,
          title: true,
          status: true,
          leadId: true,
          createdAt: true,
          updatedAt: true,
          estimatedValue: true,
          client: { select: { name: true } },
          lead: { select: { name: true } },
          seller: { select: { name: true } },
          stage: { select: { name: true } },
        },
      }),
      prisma.project.findMany({
        where: { organizationId, status: { not: "CANCELLED" } },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          createdAt: true,
          completedAt: true,
          client: { select: { name: true } },
          manager: { select: { name: true } },
          measurementVisits: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true, doneAt: true } },
          technicalApproval: { select: { status: true, createdAt: true, approvedAt: true } },
          productionOrder: { select: { stage: true, releasedAt: true, outForDeliveryAt: true, deliveredAt: true } },
          postSales: { where: { status: { in: ["PENDING", "CONTACTED", "NEEDS_ASSISTANCE"] } }, select: { id: true }, take: 1 },
        },
      }),
      prisma.assistanceTicket.findMany({
        where: { organizationId, status: { notIn: ["RESOLVED", "CANCELLED"] } },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          createdAt: true,
          scheduledAt: true,
          clientConfirmedAt: true,
          optionsSentAt: true,
          rescheduleRequestedAt: true,
          projectId: true,
          client: { select: { name: true } },
          assignee: { select: { name: true } },
        },
      }),
    ]);

    const leadsWithOpp = new Set(opps.map((o) => o.leadId).filter(Boolean));
    for (const l of leads) {
      if (leadsWithOpp.has(l.id)) continue;
      push({
        id: l.id,
        kind: "LEAD",
        stage: "PRE_VENDA",
        title: l.name,
        subtitle: l.interest,
        value: null,
        since: l.lastContactAt ?? l.enteredAt,
        owner: l.seller?.name ?? null,
        link: "/comercial",
        badge: l.status === "NEW" ? "Lead novo" : l.status === "CONTACTED" ? "Contatado" : "Qualificado",
      });
    }
    for (const o of opps) {
      push({
        id: o.id,
        kind: "OPPORTUNITY",
        stage: "PRE_VENDA",
        title: o.title,
        subtitle: o.client?.name ?? o.lead?.name ?? null,
        value: num(o.estimatedValue),
        since: o.updatedAt,
        owner: o.seller?.name ?? null,
        link: "/comercial",
        badge: o.stage.name,
      });
    }

    const PRODUCTION_BADGE: Record<string, string> = {
      RELEASED: "Liberado",
      IN_PRODUCTION: "Em produção",
      PRE_ASSEMBLY: "Pré-montagem",
    };
    for (const p of projects) {
      const m = p.measurementVisits[0] ?? null;
      const derived = deriveProjectStage(
        {
          projectStatus: p.status,
          createdAt: p.createdAt,
          completedAt: p.completedAt,
          measurement: m,
          techApproval: p.technicalApproval,
          production: p.productionOrder,
          pendingPostSale: p.postSales.length > 0,
        },
        now
      );
      if (!derived) continue;
      let badge: string | null = null;
      if (derived.stage === "MEDICAO") badge = m ? (m.status === "SCHEDULED" ? "Agendada" : m.status === "REQUESTED" ? "Solicitada" : null) : "Sem medição";
      if (derived.stage === "PROJETO_TECNICO") {
        const s = p.technicalApproval?.status;
        badge = s === "IN_REVIEW" ? "Com o cliente" : s === "CHANGES_REQUESTED" ? "Ajustes pedidos" : "Em elaboração";
      }
      if (derived.stage === "PRODUCAO") badge = PRODUCTION_BADGE[p.productionOrder?.stage ?? ""] ?? "Aguardando liberação";
      push({
        id: p.id,
        kind: "PROJECT",
        stage: derived.stage,
        title: `${p.code} — ${p.name}`,
        subtitle: p.client.name,
        value: null,
        since: derived.since,
        owner: p.manager?.name ?? null,
        link: `/clientes-projetos/${p.id}`,
        badge,
      });
    }

    for (const t of tickets) {
      const badge = t.rescheduleRequestedAt && !t.scheduledAt
        ? "Remarcar"
        : t.scheduledAt
          ? t.clientConfirmedAt ? "Visita confirmada" : "Visita marcada"
          : t.optionsSentAt ? "Aguardando cliente" : "Sem datas";
      push({
        id: t.id,
        kind: "ASSISTANCE",
        stage: "ASSISTENCIA",
        title: `${t.number} — ${t.title}`,
        subtitle: t.client.name,
        value: null,
        since: t.createdAt,
        owner: t.assignee?.name ?? null,
        link: t.projectId ? `/clientes-projetos/${t.projectId}` : "/organizacao",
        badge,
      });
    }

    const columns = PIPELINE_STAGES.map((stage) => {
      const list = cards.filter((c) => c.stage === stage).sort((a, b) => b.daysInStage - a.daysInStage);
      return {
        stage,
        label: PIPELINE_LABEL[stage],
        staleAfterDays: PIPELINE_STALE_DAYS[stage],
        count: list.length,
        staleCount: list.filter((c) => c.stale).length,
        value: round2(list.reduce((a, c) => a + (c.value ?? 0), 0)),
        cards: list,
      };
    });
    return ok(res, { generatedAt: now, columns });
  })
);

// ============================ Ponto de equilíbrio ============================

const breakEvenKey = (organizationId: string) => `store.breakeven.${organizationId}`;
type BreakEvenConfig = { fixedCostMonthly?: number | null; contributionMarginPct?: number | null; referenceMonths?: number };

async function loadBreakEvenConfig(organizationId: string): Promise<BreakEvenConfig> {
  const row = await prisma.setting.findUnique({ where: { key: breakEvenKey(organizationId) } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as BreakEvenConfig;
  } catch {
    return {};
  }
}

async function averageTicket(organizationId: string, now: Date) {
  const won = await prisma.commercialOpportunity.findMany({
    where: { organizationId, status: "WON", wonAt: { gte: new Date(now.getTime() - 180 * DAY_MS) } },
    select: { estimatedValue: true },
  });
  const values = won.map((w) => num(w.estimatedValue)).filter((v) => v > 0);
  return { ticket: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, sample: values.length };
}

async function breakEvenFor(organizationId: string, now = new Date()) {
  const cfg = await loadBreakEvenConfig(organizationId);
  const months = Math.min(Math.max(cfg.referenceMonths ?? 3, 1), 12);
  const today = fortalezaToday(now);
  const monthStart = fortalezaMonthStart(today.year, today.monthIndex);
  const refStart = fortalezaMonthStart(today.year, today.monthIndex - months);

  const [refTxs, currentRevenue, mappingsRows, ticket] = await Promise.all([
    prisma.financeTransaction.findMany({
      where: { organizationId, status: "PAGO", date: { gte: refStart, lt: monthStart } },
      select: { type: true, category: true, amount: true },
    }),
    prisma.financeTransaction.aggregate({
      where: { organizationId, status: "PAGO", type: "RECEITA", date: { gte: monthStart, lte: now } },
      _sum: { amount: true },
    }),
    prisma.dreCategoryMapping.findMany({ where: { organizationId }, select: { category: true, dreLine: true } }),
    averageTicket(organizationId, now),
  ]);

  // Sem histórico nos meses anteriores (loja começou agora): usa o mês corrente.
  let transactions = refTxs.map((t) => ({ type: t.type, category: t.category, amount: num(t.amount) }));
  let referenceMonths = months;
  let usingCurrentMonth = false;
  if (!transactions.length) {
    const cur = await prisma.financeTransaction.findMany({
      where: { organizationId, status: "PAGO", date: { gte: monthStart, lte: now } },
      select: { type: true, category: true, amount: true },
    });
    transactions = cur.map((t) => ({ type: t.type, category: t.category, amount: num(t.amount) }));
    referenceMonths = 1;
    usingCurrentMonth = transactions.length > 0;
  }

  const result = computeBreakEven({
    transactions,
    months: referenceMonths,
    mappings: Object.fromEntries(mappingsRows.map((m) => [m.category, m.dreLine])),
    currentMonthRevenue: num(currentRevenue._sum.amount),
    averageTicket: ticket.ticket,
    dayOfMonth: today.day,
    daysInMonth: today.daysInMonth,
    override: { fixedCostMonthly: cfg.fixedCostMonthly ?? null, contributionMarginPct: cfg.contributionMarginPct ?? null },
  });
  if (usingCurrentMonth) result.warnings.push("Sem histórico dos meses anteriores: cálculo feito só com o mês atual.");
  return { ...result, configuredReferenceMonths: months, ticketSample: ticket.sample, config: cfg };
}

// GET /api/store/break-even
router.get(
  "/break-even",
  requireAnyPermission(["finance.read", "commercial.read"]),
  asyncHandler(async (req, res) => ok(res, await breakEvenFor(req.user!.organizationId)))
);

// PUT /api/store/break-even  { fixedCostMonthly?, contributionMarginPct?, referenceMonths? } (null = volta ao calculado)
router.put(
  "/break-even",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        fixedCostMonthly: z.coerce.number().min(0).max(1e9).nullable().optional(),
        contributionMarginPct: z.coerce.number().gt(0).max(100).nullable().optional(),
        referenceMonths: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(req.body);
    const key = breakEvenKey(req.user!.organizationId);
    const current = await loadBreakEvenConfig(req.user!.organizationId);
    const next: BreakEvenConfig = {
      fixedCostMonthly: input.fixedCostMonthly === undefined ? current.fixedCostMonthly ?? null : input.fixedCostMonthly,
      contributionMarginPct: input.contributionMarginPct === undefined ? current.contributionMarginPct ?? null : input.contributionMarginPct,
      referenceMonths: input.referenceMonths ?? current.referenceMonths ?? 3,
    };
    await prisma.setting.upsert({ where: { key }, create: { key, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return ok(res, await breakEvenFor(req.user!.organizationId), "Configuração salva");
  })
);

// ============================ Painel da loja ============================

// GET /api/store/dashboard?months=6
router.get(
  "/dashboard",
  requireAnyPermission(["finance.read", "commercial.read"]),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const canFinance = req.user!.permissions.includes("finance.read");
    const canCommercial = req.user!.permissions.includes("commercial.read");
    const seriesMonths = intQuery(req.query.months, { min: 3, max: 12, name: "months" }) ?? 6;
    const withBreakEven = boolQuery(req.query.breakEven) ?? true;

    const now = new Date();
    const today = fortalezaToday(now);
    const monthStart = fortalezaMonthStart(today.year, today.monthIndex);
    const prevStart = fortalezaMonthStart(today.year, today.monthIndex - 1);
    // mesmo ponto do mês anterior, para comparar "até hoje" com "até o mesmo dia"
    const prevSameDay = new Date(prevStart.getTime() + (now.getTime() - monthStart.getTime()));

    const commercial = canCommercial
      ? await (async () => {
          const [wonCur, wonPrev, leadsCur, leadsPrev, openOpps, leads90, won90] = await Promise.all([
            prisma.commercialOpportunity.findMany({ where: { organizationId, status: "WON", wonAt: { gte: monthStart, lte: now } }, select: { estimatedValue: true } }),
            prisma.commercialOpportunity.findMany({ where: { organizationId, status: "WON", wonAt: { gte: prevStart, lte: prevSameDay } }, select: { estimatedValue: true } }),
            prisma.commercialLead.count({ where: { organizationId, enteredAt: { gte: monthStart, lte: now } } }),
            prisma.commercialLead.count({ where: { organizationId, enteredAt: { gte: prevStart, lte: prevSameDay } } }),
            prisma.commercialOpportunity.aggregate({
              where: { organizationId, status: { in: ["OPEN", "NEGOTIATION", "WAITING_CLIENT"] } },
              _sum: { estimatedValue: true },
              _count: true,
            }),
            prisma.commercialLead.count({ where: { organizationId, enteredAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } } }),
            prisma.commercialOpportunity.count({ where: { organizationId, status: "WON", wonAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } } }),
          ]);
          const sum = (rows: { estimatedValue: unknown }[]) => round2(rows.reduce((a, r) => a + num(r.estimatedValue), 0));
          const ticket = await averageTicket(organizationId, now);
          return {
            salesCount: wonCur.length,
            salesValue: sum(wonCur),
            salesValueChangePct: pctChange(sum(wonCur), sum(wonPrev)),
            salesCountPrev: wonPrev.length,
            newLeads: leadsCur,
            newLeadsChangePct: pctChange(leadsCur, leadsPrev),
            openPipelineCount: openOpps._count,
            openPipelineValue: round2(num(openOpps._sum.estimatedValue)),
            averageTicket: ticket.ticket === null ? null : round2(ticket.ticket),
            conversion90dPct: leads90 > 0 ? round2((won90 / leads90) * 100) : null,
          };
        })()
      : null;

    const finance = canFinance
      ? await (async () => {
          const in30 = new Date(now.getTime() + 30 * DAY_MS);
          const [paidCur, paidPrev, receivable, payable, overdueRec, overduePay, seriesTx] = await Promise.all([
            prisma.financeTransaction.groupBy({ by: ["type"], where: { organizationId, status: "PAGO", date: { gte: monthStart, lte: now } }, _sum: { amount: true } }),
            prisma.financeTransaction.groupBy({ by: ["type"], where: { organizationId, status: "PAGO", date: { gte: prevStart, lte: prevSameDay } }, _sum: { amount: true } }),
            prisma.financeTransaction.aggregate({ where: { organizationId, status: "PENDENTE", type: "RECEITA", dueDate: { gte: now, lte: in30 } }, _sum: { amount: true }, _count: true }),
            prisma.financeTransaction.aggregate({ where: { organizationId, status: "PENDENTE", type: "DESPESA", dueDate: { gte: now, lte: in30 } }, _sum: { amount: true }, _count: true }),
            prisma.financeTransaction.aggregate({ where: { organizationId, status: "PENDENTE", type: "RECEITA", dueDate: { lt: now } }, _sum: { amount: true }, _count: true }),
            prisma.financeTransaction.aggregate({ where: { organizationId, status: "PENDENTE", type: "DESPESA", dueDate: { lt: now } }, _sum: { amount: true }, _count: true }),
            prisma.financeTransaction.findMany({
              where: { organizationId, status: "PAGO", date: { gte: fortalezaMonthStart(today.year, today.monthIndex - (seriesMonths - 1)), lte: now } },
              select: { type: true, amount: true, date: true },
            }),
          ]);
          const byType = (rows: { type: string; _sum: { amount: unknown } }[], t: string) => round2(num(rows.find((r) => r.type === t)?._sum.amount));
          const revenue = byType(paidCur, "RECEITA");
          const expense = byType(paidCur, "DESPESA");

          const series = Array.from({ length: seriesMonths }, (_, i) => {
            const start = fortalezaMonthStart(today.year, today.monthIndex - (seriesMonths - 1 - i));
            const end = fortalezaMonthStart(today.year, today.monthIndex - (seriesMonths - 1 - i) + 1);
            const inMonth = seriesTx.filter((t) => t.date >= start && t.date < end);
            const rev = round2(inMonth.filter((t) => t.type === "RECEITA").reduce((a, t) => a + num(t.amount), 0));
            const exp = round2(inMonth.filter((t) => t.type === "DESPESA").reduce((a, t) => a + num(t.amount), 0));
            const label = new Date(start.getTime() + DAY_MS).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Fortaleza" }).replace(".", "");
            return { month: label, revenue: rev, expense: exp, result: round2(rev - exp) };
          });

          return {
            revenue,
            expense,
            result: round2(revenue - expense),
            revenueChangePct: pctChange(revenue, byType(paidPrev, "RECEITA")),
            expenseChangePct: pctChange(expense, byType(paidPrev, "DESPESA")),
            receivable30d: { total: round2(num(receivable._sum.amount)), count: receivable._count },
            payable30d: { total: round2(num(payable._sum.amount)), count: payable._count },
            overdueReceivable: { total: round2(num(overdueRec._sum.amount)), count: overdueRec._count },
            overduePayable: { total: round2(num(overduePay._sum.amount)), count: overduePay._count },
            series,
          };
        })()
      : null;

    const [inProduction, measurementsScheduled, openAssistances, unconfirmedVisits] = await Promise.all([
      prisma.productionOrder.count({ where: { organizationId, stage: { in: ["RELEASED", "IN_PRODUCTION", "PRE_ASSEMBLY", "OUT_FOR_DELIVERY"] } } }),
      prisma.measurementVisit.count({ where: { organizationId, status: "SCHEDULED" } }),
      prisma.assistanceTicket.count({ where: { organizationId, status: { notIn: ["RESOLVED", "CANCELLED"] } } }),
      prisma.assistanceTicket.count({
        where: { organizationId, status: "SCHEDULED", clientConfirmedAt: null, scheduledAt: { gte: now, lte: new Date(now.getTime() + 2 * DAY_MS) } },
      }),
    ]);

    return ok(res, {
      month: { year: today.year, month: today.monthIndex + 1, day: today.day, daysInMonth: today.daysInMonth },
      commercial,
      finance,
      operation: { inProduction, measurementsScheduled, openAssistances, unconfirmedVisits },
      breakEven: canFinance && withBreakEven ? await breakEvenFor(organizationId, now) : null,
    });
  })
);

export default router;
