import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";

const router = Router();
router.use(authenticate);

const nullable = (max: number) => z.string().trim().max(max).optional().nullable().or(z.literal(""));
const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const nn = (v: string | null | undefined) => (v ? v : null);

async function audit(userId: string, action: string, entity: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity, entityId, details } });
}

/** Escopo: quem não tem commercial.read.all só enxerga a própria carteira. */
function sellerScope(req: { user?: { id: string; permissions: string[] } }) {
  return req.user!.permissions.includes("commercial.read.all") ? {} : { sellerId: req.user!.id };
}

const DAY = 86400000;
/** Score 0–100 = probabilidade da etapa (peso 60) + valor relativo (25) + recência do último contato (15). */
function opportunityScore(opp: {
  probability: number;
  estimatedValue: Prisma.Decimal | number;
  interactions: { occurredAt: Date }[];
  expectedCloseAt: Date | null;
}) {
  const prob = Math.max(0, Math.min(100, opp.probability));
  const value = money(opp.estimatedValue);
  const valueScore = value <= 0 ? 0 : Math.min(25, Math.log10(value + 1) * 6);
  const last = opp.interactions[0]?.occurredAt;
  const daysSince = last ? (Date.now() - last.getTime()) / DAY : 999;
  const recencyScore = daysSince <= 3 ? 15 : daysSince <= 7 ? 11 : daysSince <= 15 ? 6 : daysSince <= 30 ? 2 : 0;
  return Math.round(prob * 0.6 + valueScore + recencyScore);
}

// ============================================================
// ETAPAS DO FUNIL (SalesStage)
// ============================================================

router.get(
  "/stages",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.salesStage.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { position: "asc" },
      include: { _count: { select: { opportunities: true } } },
    });
    return ok(res, rows);
  })
);

router.post(
  "/stages",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        probability: z.coerce.number().int().min(0).max(100).default(0),
        isWon: z.boolean().default(false),
        isLost: z.boolean().default(false),
      })
      .parse(req.body);
    const max = await prisma.salesStage.aggregate({ where: { organizationId: req.user!.organizationId }, _max: { position: true } });
    const stage = await prisma.salesStage.create({
      data: { ...input, position: (max._max.position ?? 0) + 1, organizationId: req.user!.organizationId },
    });
    return ok(res, stage, "Etapa criada");
  })
);

router.patch(
  "/stages/:id",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.salesStage.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Etapa não encontrada");
    const input = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        probability: z.coerce.number().int().min(0).max(100).optional(),
        position: z.coerce.number().int().min(1).optional(),
        active: z.boolean().optional(),
        isWon: z.boolean().optional(),
        isLost: z.boolean().optional(),
      })
      .parse(req.body);
    const stage = await prisma.salesStage.update({ where: { id: cur.id }, data: input });
    return ok(res, stage, "Etapa atualizada");
  })
);

// ============================================================
// LEADS
// ============================================================

const leadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  phone: nullable(30),
  email: z.string().email().optional().nullable().or(z.literal("")),
  source: nullable(80),
  interest: nullable(200),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  notes: nullable(5000),
  sellerId: z.string().min(1).optional().nullable(),
  nextContactAt: z.coerce.date().optional().nullable(),
});

router.get(
  "/leads",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.commercialLead.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...sellerScope(req),
        ...(req.query.status ? { status: req.query.status as never } : {}),
      },
      include: { seller: { select: { id: true, name: true } }, _count: { select: { opportunities: true, interactions: true } } },
      orderBy: [{ status: "asc" }, { enteredAt: "desc" }],
    });
    return ok(res, rows);
  })
);

router.post(
  "/leads",
  requirePermission("commercial.leads.manage"),
  asyncHandler(async (req, res) => {
    const input = leadSchema.parse(req.body);
    const lead = await prisma.commercialLead.create({
      data: {
        organizationId: req.user!.organizationId,
        name: input.name,
        phone: nn(input.phone),
        email: nn(input.email),
        source: nn(input.source),
        interest: nn(input.interest),
        notes: nn(input.notes),
        status: input.status ?? "NEW",
        sellerId: input.sellerId ?? req.user!.id,
        nextContactAt: input.nextContactAt ?? null,
      },
    });
    await audit(req.user!.id, "COMMERCIAL_LEAD_CREATED", "CommercialLead", lead.id, { name: lead.name });
    return ok(res, lead, "Lead criado");
  })
);

router.patch(
  "/leads/:id",
  requirePermission("commercial.leads.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.commercialLead.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Lead não encontrado");
    const input = leadSchema.partial().parse(req.body);
    const lead = await prisma.commercialLead.update({
      where: { id: cur.id },
      data: {
        name: input.name,
        phone: input.phone === undefined ? undefined : nn(input.phone),
        email: input.email === undefined ? undefined : nn(input.email),
        source: input.source === undefined ? undefined : nn(input.source),
        interest: input.interest === undefined ? undefined : nn(input.interest),
        notes: input.notes === undefined ? undefined : nn(input.notes),
        status: input.status,
        sellerId: input.sellerId === undefined ? undefined : input.sellerId,
        nextContactAt: input.nextContactAt === undefined ? undefined : input.nextContactAt,
        lastContactAt: input.status === "CONTACTED" ? new Date() : undefined,
      },
    });
    return ok(res, lead, "Lead atualizado");
  })
);

/** Converte o lead em Cliente + Oportunidade na 1ª etapa. */
router.post(
  "/leads/:id/convert",
  requirePermission("commercial.leads.manage"),
  asyncHandler(async (req, res) => {
    const lead = await prisma.commercialLead.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!lead) throw new NotFoundError("Lead não encontrado");
    if (lead.status === "CONVERTED") throw new BadRequestError("Lead já convertido");

    const input = z
      .object({
        clientId: z.string().min(1).optional(),
        title: z.string().trim().min(2).max(200).optional(),
        estimatedValue: z.coerce.number().min(0).default(0),
        stageId: z.string().min(1).optional(),
      })
      .parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      let clientId = input.clientId ?? null;
      if (!clientId) {
        const client = await tx.client.create({
          data: {
            organizationId: req.user!.organizationId,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            notes: lead.interest ? `Interesse: ${lead.interest}` : null,
            sellerId: lead.sellerId,
          },
        });
        clientId = client.id;
      }
      const stage =
        (input.stageId
          ? await tx.salesStage.findFirst({ where: { id: input.stageId, organizationId: req.user!.organizationId } })
          : null) ??
        (await tx.salesStage.findFirst({
          where: { organizationId: req.user!.organizationId, isWon: false, isLost: false, active: true },
          orderBy: { position: "asc" },
        }));
      if (!stage) throw new BadRequestError("Nenhuma etapa de funil cadastrada");

      const opp = await tx.commercialOpportunity.create({
        data: {
          organizationId: req.user!.organizationId,
          title: input.title ?? `${lead.name}${lead.interest ? ` — ${lead.interest}` : ""}`,
          stageId: stage.id,
          probability: stage.probability,
          estimatedValue: new Prisma.Decimal(input.estimatedValue.toFixed(2)),
          source: lead.source,
          clientId,
          leadId: lead.id,
          sellerId: lead.sellerId ?? req.user!.id,
        },
      });
      await tx.commercialLead.update({
        where: { id: lead.id },
        data: { status: "CONVERTED", convertedAt: new Date(), convertedClientId: clientId },
      });
      return { clientId, opportunityId: opp.id };
    });

    await audit(req.user!.id, "COMMERCIAL_LEAD_CONVERTED", "CommercialLead", lead.id, result);
    return ok(res, result, "Lead convertido em oportunidade");
  })
);

// ============================================================
// OPORTUNIDADES (funil)
// ============================================================

const oppSchema = z.object({
  title: z.string().trim().min(2).max(200),
  stageId: z.string().min(1),
  clientId: z.string().min(1).optional().nullable(),
  estimatedValue: z.coerce.number().min(0).default(0),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseAt: z.coerce.date().optional().nullable(),
  source: nullable(80),
  notes: nullable(5000),
  nextAction: nullable(200),
  nextActionAt: z.coerce.date().optional().nullable(),
  sellerId: z.string().min(1).optional(),
});

const oppInclude = {
  stage: { select: { id: true, name: true, position: true, isWon: true, isLost: true } },
  client: { select: { id: true, name: true } },
  seller: { select: { id: true, name: true } },
  interactions: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" as const }, take: 1 },
  _count: { select: { interactions: true, quotes: true } },
};

const serializeOpp = (o: {
  id: string; title: string; status: string; estimatedValue: Prisma.Decimal; probability: number;
  expectedCloseAt: Date | null; nextAction: string | null; nextActionAt: Date | null; position: number;
  createdAt: Date; lostReason: string | null;
  stage: { id: string; name: string; position: number; isWon: boolean; isLost: boolean };
  client: { id: string; name: string } | null;
  seller: { id: string; name: string };
  interactions: { occurredAt: Date }[];
  _count: { interactions: number; quotes: number };
}) => ({
  id: o.id,
  title: o.title,
  status: o.status,
  estimatedValue: money(o.estimatedValue),
  probability: o.probability,
  weightedValue: Math.round(money(o.estimatedValue) * (o.probability / 100)),
  expectedCloseAt: o.expectedCloseAt,
  nextAction: o.nextAction,
  nextActionAt: o.nextActionAt,
  lostReason: o.lostReason,
  position: o.position,
  createdAt: o.createdAt,
  stage: o.stage,
  client: o.client,
  seller: o.seller,
  lastInteractionAt: o.interactions[0]?.occurredAt ?? null,
  interactionCount: o._count.interactions,
  quoteCount: o._count.quotes,
  score: opportunityScore(o),
});

// Kanban: oportunidades abertas agrupadas por etapa
router.get(
  "/opportunities",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const includeClosed = req.query.closed === "1";
    const rows = await prisma.commercialOpportunity.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...sellerScope(req),
        ...(includeClosed ? {} : { status: { notIn: ["WON", "LOST"] } }),
        ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
      },
      include: oppInclude,
      orderBy: [{ stage: { position: "asc" } }, { position: "asc" }, { createdAt: "desc" }],
    });
    return ok(res, rows.map(serializeOpp));
  })
);

router.post(
  "/opportunities",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = oppSchema.parse(req.body);
    const stage = await prisma.salesStage.findFirst({ where: { id: input.stageId, organizationId: req.user!.organizationId } });
    if (!stage) throw new BadRequestError("Etapa inválida");
    if (input.clientId) {
      const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: req.user!.organizationId } });
      if (!c) throw new BadRequestError("Cliente inválido");
    }
    const opp = await prisma.commercialOpportunity.create({
      data: {
        organizationId: req.user!.organizationId,
        title: input.title,
        stageId: stage.id,
        clientId: input.clientId ?? null,
        estimatedValue: new Prisma.Decimal(input.estimatedValue.toFixed(2)),
        probability: input.probability ?? stage.probability,
        expectedCloseAt: input.expectedCloseAt ?? null,
        source: nn(input.source),
        notes: nn(input.notes),
        nextAction: nn(input.nextAction),
        nextActionAt: input.nextActionAt ?? null,
        sellerId: input.sellerId ?? req.user!.id,
      },
      include: oppInclude,
    });
    await audit(req.user!.id, "COMMERCIAL_OPPORTUNITY_CREATED", "CommercialOpportunity", opp.id, { title: opp.title });
    return ok(res, serializeOpp(opp), "Oportunidade criada");
  })
);

router.patch(
  "/opportunities/:id",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.commercialOpportunity.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!cur) throw new NotFoundError("Oportunidade não encontrada");

    const input = z
      .object({
        title: z.string().trim().min(2).max(200).optional(),
        stageId: z.string().min(1).optional(),
        estimatedValue: z.coerce.number().min(0).optional(),
        probability: z.coerce.number().int().min(0).max(100).optional(),
        expectedCloseAt: z.coerce.date().optional().nullable(),
        notes: nullable(5000),
        nextAction: nullable(200),
        nextActionAt: z.coerce.date().optional().nullable(),
        position: z.coerce.number().int().min(0).optional(),
        action: z.enum(["win", "lose", "reopen"]).optional(),
        lostReason: nullable(300),
      })
      .parse(req.body);

    const data: Prisma.CommercialOpportunityUpdateInput = {
      title: input.title,
      estimatedValue: input.estimatedValue === undefined ? undefined : new Prisma.Decimal(input.estimatedValue.toFixed(2)),
      probability: input.probability,
      expectedCloseAt: input.expectedCloseAt === undefined ? undefined : input.expectedCloseAt,
      notes: input.notes === undefined ? undefined : nn(input.notes),
      nextAction: input.nextAction === undefined ? undefined : nn(input.nextAction),
      nextActionAt: input.nextActionAt === undefined ? undefined : input.nextActionAt,
      position: input.position,
    };

    if (input.stageId && input.stageId !== cur.stageId) {
      const stage = await prisma.salesStage.findFirst({ where: { id: input.stageId, organizationId: req.user!.organizationId } });
      if (!stage) throw new BadRequestError("Etapa inválida");
      data.stage = { connect: { id: stage.id } };
      data.probability = input.probability ?? stage.probability;
      if (stage.isWon) data.status = "WON";
      else if (stage.isLost) data.status = "LOST";
      else if (cur.status === "WON" || cur.status === "LOST") data.status = "OPEN";
    }

    if (input.action === "win") data.status = "WON";
    if (input.action === "lose") {
      data.status = "LOST";
      data.lostReason = nn(input.lostReason);
    }
    if (input.action === "reopen") data.status = "OPEN";

    const opp = await prisma.commercialOpportunity.update({ where: { id: cur.id }, data, include: oppInclude });
    await audit(req.user!.id, "COMMERCIAL_OPPORTUNITY_UPDATED", "CommercialOpportunity", opp.id, {
      from: cur.stageId,
      to: opp.stageId,
      status: opp.status,
    });
    return ok(res, serializeOpp(opp), "Oportunidade atualizada");
  })
);

router.post(
  "/opportunities/:id/interactions",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const opp = await prisma.commercialOpportunity.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true, leadId: true, clientId: true },
    });
    if (!opp) throw new NotFoundError("Oportunidade não encontrada");
    const input = z
      .object({
        type: z.enum(["CALL", "WHATSAPP", "EMAIL", "MEETING", "VISIT", "INTERNAL_MESSAGE", "OTHER"]),
        summary: z.string().trim().min(2).max(2000),
        result: nullable(500),
        occurredAt: z.coerce.date().optional(),
        nextAction: nullable(200),
        nextActionAt: z.coerce.date().optional().nullable(),
      })
      .parse(req.body);

    const interaction = await prisma.commercialInteraction.create({
      data: {
        type: input.type,
        summary: input.summary,
        result: nn(input.result),
        occurredAt: input.occurredAt ?? new Date(),
        nextAction: nn(input.nextAction),
        nextActionAt: input.nextActionAt ?? null,
        opportunityId: opp.id,
        leadId: opp.leadId,
        clientId: opp.clientId,
        responsibleId: req.user!.id,
      },
    });
    if (input.nextAction || input.nextActionAt) {
      await prisma.commercialOpportunity.update({
        where: { id: opp.id },
        data: { nextAction: nn(input.nextAction) ?? undefined, nextActionAt: input.nextActionAt ?? undefined },
      });
    }
    return ok(res, interaction, "Interação registrada");
  })
);

router.get(
  "/opportunities/:id",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const opp = await prisma.commercialOpportunity.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        ...oppInclude,
        interactions: {
          orderBy: { occurredAt: "desc" },
          include: { responsible: { select: { id: true, name: true } } },
        },
        quotes: { select: { id: true, number: true, status: true, total: true, issuedAt: true } },
      },
    });
    if (!opp) throw new NotFoundError("Oportunidade não encontrada");
    return ok(res, opp);
  })
);

// ============================================================
// RESUMO DO FUNIL
// ============================================================

router.get(
  "/pipeline",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const stages = await prisma.salesStage.findMany({
      where: { organizationId: req.user!.organizationId, active: true },
      orderBy: { position: "asc" },
    });
    const opps = await prisma.commercialOpportunity.findMany({
      where: { organizationId: req.user!.organizationId, ...sellerScope(req) },
      select: { stageId: true, status: true, estimatedValue: true, probability: true, createdAt: true },
    });

    const open = opps.filter((o) => o.status !== "WON" && o.status !== "LOST");
    const byStage = stages.map((s) => {
      const items = open.filter((o) => o.stageId === s.id);
      const total = items.reduce((a, o) => a + money(o.estimatedValue), 0);
      const weighted = items.reduce((a, o) => a + money(o.estimatedValue) * (o.probability / 100), 0);
      return { id: s.id, name: s.name, count: items.length, total: Math.round(total), weighted: Math.round(weighted) };
    });

    const won = opps.filter((o) => o.status === "WON");
    const lost = opps.filter((o) => o.status === "LOST");
    const closed = won.length + lost.length;

    return ok(res, {
      byStage,
      openCount: open.length,
      openValue: Math.round(open.reduce((a, o) => a + money(o.estimatedValue), 0)),
      forecast: Math.round(open.reduce((a, o) => a + money(o.estimatedValue) * (o.probability / 100), 0)),
      wonCount: won.length,
      wonValue: Math.round(won.reduce((a, o) => a + money(o.estimatedValue), 0)),
      lostCount: lost.length,
      winRate: closed > 0 ? Math.round((won.length / closed) * 100) : 0,
    });
  })
);

export default router;
