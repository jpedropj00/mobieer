/**
 * Metas comerciais: /api/commercial/goals
 *
 * Quem não tem commercial.read.all (o CONSULTOR) só vê a própria meta e as
 * próprias vendas — o mesmo escopo que o funil já aplica.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { conversionRate, goalProgress, monthRange, parseMonth } from "./goals.service";

const router = Router();
router.use(authenticate);

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

async function monthNumbers(organizationId: string, month: string, sellerId: string | null) {
  const { from, to } = monthRange(month);
  const bySeller = sellerId ? { sellerId } : {};

  const [sales, proposals, openOpps, goalRow] = await Promise.all([
    prisma.sale.findMany({ where: { organizationId, soldAt: { gte: from, lt: to }, ...bySeller }, select: { value: true } }),
    prisma.commercialProposal.count({ where: { organizationId, createdAt: { gte: from, lt: to }, ...bySeller } }),
    prisma.commercialOpportunity.findMany({
      where: { organizationId, status: { notIn: ["WON", "LOST"] }, expectedCloseAt: { gte: from, lt: to }, ...bySeller },
      select: { estimatedValue: true, probability: true },
    }),
    prisma.salesGoal.findFirst({ where: { organizationId, month, userId: sellerId } }),
  ]);

  const sold = sales.reduce((s, v) => s + money(v.value), 0);
  const weighted = openOpps.reduce((s, o) => s + money(o.estimatedValue) * (o.probability / 100), 0);
  const progress = goalProgress({ goal: goalRow ? money(goalRow.amount) : null, sold, weightedPipeline: weighted, month });

  return {
    ...progress,
    salesCount: sales.length,
    ticketMedio: sales.length ? Math.round(sold / sales.length) : 0,
    proposals,
    conversion: conversionRate(proposals, sales.length),
    openOpportunities: openOpps.length,
    forecastLabel: "Estimativa: vendido no mês mais as oportunidades previstas para fechar, ponderadas pela probabilidade.",
  };
}

// GET /api/commercial/goals/dashboard?month=aaaa-mm&sellerId=
router.get(
  "/dashboard",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const month = parseMonth(req.query.month);
    const organizationId = req.user!.organizationId;
    const seeAll = req.user!.permissions.includes("commercial.read.all");

    // consultor: sempre ele mesmo, ignora o sellerId pedido
    const sellerId = seeAll ? (req.query.sellerId ? String(req.query.sellerId) : null) : req.user!.id;
    const main = await monthNumbers(organizationId, month, sellerId);

    // quem vê tudo recebe também a quebra por consultor
    let bySeller: ({ sellerId: string; name: string } & Awaited<ReturnType<typeof monthNumbers>>)[] = [];
    if (seeAll && !req.query.sellerId) {
      const sellers = await prisma.user.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          OR: [{ commercialSales: { some: {} } }, { assignedOpportunities: { some: {} } }, { salesGoals: { some: { month } } }],
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      bySeller = await Promise.all(sellers.map(async (s) => ({ sellerId: s.id, name: s.name, ...(await monthNumbers(organizationId, month, s.id)) })));
    }

    return ok(res, { month, scope: sellerId ? "seller" : "store", ...main, bySeller });
  })
);

// GET /api/commercial/goals?month=
router.get(
  "/",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const month = parseMonth(req.query.month);
    const seeAll = req.user!.permissions.includes("commercial.read.all");
    const rows = await prisma.salesGoal.findMany({
      where: { organizationId: req.user!.organizationId, month, ...(seeAll ? {} : { userId: req.user!.id }) },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok(res, rows.map((r) => ({ id: r.id, month: r.month, amount: money(r.amount), user: r.user })));
  })
);

// PUT /api/commercial/goals  { month, amount, userId? }  userId vazio = meta da loja
router.put(
  "/",
  requirePermission("commercial.goals.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        month: z.string(),
        amount: z.coerce.number().min(0).max(1_000_000_000),
        userId: z.string().min(1).nullable().optional(),
      })
      .parse(req.body);
    const month = parseMonth(input.month);
    const organizationId = req.user!.organizationId;
    const userId = input.userId ?? null;

    if (userId) {
      const u = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true } });
      if (!u) throw new BadRequestError("Consultor inválido");
    }

    // upsert manual: o índice único trata NULL como distinto, então a meta da loja
    // é procurada explicitamente (há um índice parcial que impede duplicar)
    const existing = await prisma.salesGoal.findFirst({ where: { organizationId, month, userId } });
    const amount = new Prisma.Decimal(input.amount.toFixed(2));
    const goal = existing
      ? await prisma.salesGoal.update({ where: { id: existing.id }, data: { amount } })
      : await prisma.salesGoal.create({ data: { organizationId, month, userId, amount } });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: "SALES_GOAL_SET",
        entity: "SalesGoal",
        entityId: goal.id,
        details: { month, userId, from: existing ? money(existing.amount) : null, to: input.amount },
      },
    });
    return ok(res, { id: goal.id, month, amount: input.amount, userId }, "Meta salva");
  })
);

export default router;
