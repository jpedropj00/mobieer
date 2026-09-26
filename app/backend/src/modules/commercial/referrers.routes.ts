/**
 * Indicadores (arquitetos, designers, parceiros) e as reservas técnicas (RT)
 * que eles têm a receber. A RT nasce no aceite do orçamento como conta a pagar
 * (categoria "Reserva técnica", ligada ao indicador); pagar é no financeiro.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { CATEGORY_TECHNICAL_RESERVE } from "./quote.finance";

const router = Router();
router.use(authenticate);

const KINDS = ["ARQUITETO", "DESIGNER", "CORRETOR", "CONSTRUTORA", "PARCEIRO", "OUTRO"] as const;
const text = (max: number) => z.string().trim().max(max).optional().nullable();
const schema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(KINDS).default("ARQUITETO"),
  document: text(20),
  phone: text(30),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  pixKey: text(120),
  defaultRtPercent: z.coerce.number().min(0).max(30).default(0),
  notes: text(2000),
  active: z.boolean().optional(),
});
const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

// GET /api/referrers?all=1 — com totais de RT pendente e paga
router.get(
  "/",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const org = req.user!.organizationId;
    const rows = await prisma.referrer.findMany({
      where: { organizationId: org, ...(req.query.all === "1" ? {} : { active: true }) },
      orderBy: { name: "asc" },
      include: { _count: { select: { quotes: true } } },
    });
    const sums = await prisma.financeTransaction.groupBy({
      by: ["referrerId", "status"],
      where: { organizationId: org, referrerId: { in: rows.map((r) => r.id) }, category: CATEGORY_TECHNICAL_RESERVE },
      _sum: { amount: true },
    });
    const total = (id: string, status: string) => n(sums.find((s) => s.referrerId === id && s.status === status)?._sum.amount);
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        document: r.document,
        phone: r.phone,
        email: r.email,
        pixKey: r.pixKey,
        defaultRtPercent: n(r.defaultRtPercent),
        notes: r.notes,
        active: r.active,
        quotes: r._count.quotes,
        rtPending: total(r.id, "PENDENTE"),
        rtPaid: total(r.id, "PAGO"),
      }))
    );
  })
);

router.post(
  "/",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = schema.parse(req.body);
    const r = await prisma.referrer.create({
      data: { ...input, email: input.email || null, defaultRtPercent: new Prisma.Decimal(input.defaultRtPercent.toFixed(2)), organizationId: req.user!.organizationId },
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "REFERRER_CREATED", entity: "Referrer", entityId: r.id, details: { name: r.name } } });
    return ok(res, r, "Indicador cadastrado");
  })
);

router.put(
  "/:id",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.referrer.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Indicador não encontrado");
    const input = schema.parse(req.body);
    const r = await prisma.referrer.update({
      where: { id: cur.id },
      data: { ...input, email: input.email || null, defaultRtPercent: new Prisma.Decimal(input.defaultRtPercent.toFixed(2)) },
    });
    return ok(res, r, "Indicador atualizado");
  })
);

// GET /api/referrers/reserves?status=PENDENTE|PAGO&referrerId= — as RTs lançadas
router.get(
  "/reserves",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const status = z.enum(["PENDENTE", "PAGO"]).optional().parse(req.query.status || undefined);
    const rows = await prisma.financeTransaction.findMany({
      where: {
        organizationId: req.user!.organizationId,
        category: CATEGORY_TECHNICAL_RESERVE,
        referrerId: req.query.referrerId ? String(req.query.referrerId) : { not: null },
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        amount: true,
        status: true,
        dueDate: true,
        paidAt: true,
        description: true,
        referrer: { select: { id: true, name: true, pixKey: true } },
        client: { select: { id: true, name: true } },
        originQuote: { select: { id: true, number: true, version: true } },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 500,
    });
    return ok(res, rows.map((r) => ({ ...r, amount: n(r.amount) })));
  })
);

export default router;
