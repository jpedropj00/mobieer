import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storage, buildStorageKey } from "../../lib/storage";

const router = Router();
router.use(authenticate);

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
// UTC para não perder 1 dia quando a data chega como "YYYY-MM-DD" (meia-noite UTC).
const addMonths = (d: Date, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));

// ============================================================
// COMPRAS PARCELADAS
// ============================================================

router.post(
  "/installments",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        category: z.string().trim().min(1).max(120),
        description: z.string().trim().max(400).optional().nullable(),
        supplierId: z.string().min(1).optional().nullable(),
        projectId: z.string().min(1).optional().nullable(),
        firstDueDate: z.coerce.date(),
        installments: z.coerce.number().int().min(2).max(120),
        totalAmount: z.coerce.number().positive().optional(),
        amountPerInstallment: z.coerce.number().positive().optional(),
        method: z.string().trim().max(60).optional().nullable(),
      })
      .refine((v) => v.totalAmount || v.amountPerInstallment, { message: "Informe totalAmount ou amountPerInstallment" })
      .parse(req.body);

    const per = input.amountPerInstallment ?? round2((input.totalAmount as number) / input.installments);
    const group = crypto.randomUUID();

    const rows = Array.from({ length: input.installments }, (_, i) => ({
      organizationId: req.user!.organizationId,
      type: "DESPESA" as const,
      category: input.category,
      amount: D(per),
      date: addMonths(input.firstDueDate, i),
      dueDate: addMonths(input.firstDueDate, i),
      description: `${input.description ?? input.category} (${i + 1}/${input.installments})`,
      status: "PENDENTE" as const,
      method: input.method ?? "Parcelado",
      supplierId: input.supplierId ?? null,
      projectId: input.projectId ?? null,
      installmentGroup: group,
      installmentNumber: i + 1,
      installmentTotal: input.installments,
      createdById: req.user!.id,
    }));
    await prisma.financeTransaction.createMany({ data: rows });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "FINANCE_INSTALLMENT_CREATED", entity: "FinanceTransaction", entityId: group, details: { installments: input.installments, per } },
    });
    return ok(res, { group, installments: input.installments, amountPerInstallment: per }, "Compra parcelada lançada");
  })
);

router.get(
  "/installments",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.financeTransaction.findMany({
      where: { organizationId: req.user!.organizationId, installmentGroup: { not: null } },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ installmentGroup: "asc" }, { installmentNumber: "asc" }],
    });
    const groups = new Map<string, { group: string; category: string; supplier: string | null; total: number; paid: number; count: number; nextDue: string | null; installments: unknown[] }>();
    for (const r of rows) {
      const g = groups.get(r.installmentGroup!) ?? {
        group: r.installmentGroup!, category: r.category, supplier: r.supplier?.name ?? null,
        total: 0, paid: 0, count: 0, nextDue: null, installments: [],
      };
      g.total += money(r.amount);
      g.count += 1;
      if (r.status === "PAGO") g.paid += money(r.amount);
      else if (!g.nextDue && r.dueDate) g.nextDue = r.dueDate.toISOString();
      g.installments.push({ id: r.id, number: r.installmentNumber, total: r.installmentTotal, amount: money(r.amount), dueDate: r.dueDate, status: r.status });
      groups.set(r.installmentGroup!, g);
    }
    return ok(res, [...groups.values()].map((g) => ({ ...g, total: round2(g.total), paid: round2(g.paid) })));
  })
);

// ============================================================
// CARTÃO DE CRÉDITO
// ============================================================

router.get(
  "/cards",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.creditCard.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { statements: { select: { id: true, referenceMonth: true, total: true }, orderBy: { referenceMonth: "desc" }, take: 6 } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return ok(res, rows.map((c) => ({ ...c, statements: c.statements.map((s) => ({ ...s, total: money(s.total) })) })));
  })
);

router.post(
  "/cards",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        lastDigits: z.string().trim().max(4).optional().nullable(),
        closingDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
        dueDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
      })
      .parse(req.body);
    const card = await prisma.creditCard.create({ data: { ...input, organizationId: req.user!.organizationId } });
    return ok(res, card, "Cartão cadastrado");
  })
);

router.patch(
  "/cards/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.creditCard.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Cartão não encontrado");
    const input = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        lastDigits: z.string().trim().max(4).optional().nullable(),
        closingDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
        dueDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const card = await prisma.creditCard.update({ where: { id: cur.id }, data: input });
    return ok(res, card, "Cartão atualizado");
  })
);

// Sobe a fatura (PDF). A leitura automática do PDF fica como evolução — hoje as
// despesas são lançadas manualmente por categoria.
router.post(
  "/cards/:id/statements",
  requirePermission("finance.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const card = await prisma.creditCard.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!card) throw new NotFoundError("Cartão não encontrado");
    const { referenceMonth } = z.object({ referenceMonth: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);

    let fileKey: string | null = null;
    if (req.file) {
      fileKey = buildStorageKey(`cards/${card.id}`, req.file.originalname);
      await storage.put(fileKey, req.file.buffer, req.file.mimetype);
    }
    const stmt = await prisma.cardStatement.upsert({
      where: { cardId_referenceMonth: { cardId: card.id, referenceMonth } },
      create: { organizationId: req.user!.organizationId, cardId: card.id, referenceMonth, fileKey, importedById: req.user!.id },
      update: { fileKey: fileKey ?? undefined },
    });
    return ok(res, { id: stmt.id }, "Fatura registrada");
  })
);

router.get(
  "/cards/statements/:id",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const stmt = await prisma.cardStatement.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { card: { select: { name: true } }, expenses: { orderBy: { date: "asc" } } },
    });
    if (!stmt) throw new NotFoundError("Fatura não encontrada");
    return ok(res, {
      id: stmt.id,
      card: stmt.card.name,
      referenceMonth: stmt.referenceMonth,
      total: money(stmt.total),
      hasFile: Boolean(stmt.fileKey),
      expenses: stmt.expenses.map((e) => ({ ...e, amount: money(e.amount) })),
    });
  })
);

router.post(
  "/cards/statements/:id/expenses",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const stmt = await prisma.cardStatement.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!stmt) throw new NotFoundError("Fatura não encontrada");
    const input = z
      .object({
        description: z.string().trim().min(1).max(200),
        category: z.string().trim().min(1).max(60),
        amount: z.coerce.number().positive(),
        date: z.coerce.date(),
        installment: z.string().trim().max(10).optional().nullable(),
      })
      .parse(req.body);
    const exp = await prisma.cardExpense.create({
      data: { statementId: stmt.id, description: input.description, category: input.category, amount: D(input.amount), date: input.date, installment: input.installment ?? null },
    });
    const agg = await prisma.cardExpense.aggregate({ where: { statementId: stmt.id }, _sum: { amount: true } });
    await prisma.cardStatement.update({ where: { id: stmt.id }, data: { total: agg._sum.amount ?? D(0) } });
    return ok(res, { ...exp, amount: money(exp.amount) }, "Despesa adicionada");
  })
);

router.delete(
  "/cards/expenses/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const exp = await prisma.cardExpense.findFirst({
      where: { id: req.params.id, statement: { organizationId: req.user!.organizationId } },
      select: { id: true, statementId: true },
    });
    if (!exp) throw new NotFoundError("Despesa não encontrada");
    await prisma.cardExpense.delete({ where: { id: exp.id } });
    const agg = await prisma.cardExpense.aggregate({ where: { statementId: exp.statementId }, _sum: { amount: true } });
    await prisma.cardStatement.update({ where: { id: exp.statementId }, data: { total: agg._sum.amount ?? D(0) } });
    return ok(res, { id: exp.id }, "Despesa removida");
  })
);

// Análise: gasto por categoria / por cartão / por mês
router.get(
  "/cards/analysis",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? String(req.query.from) : null; // YYYY-MM
    const to = req.query.to ? String(req.query.to) : null;
    const statements = await prisma.cardStatement.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(from ? { referenceMonth: { gte: from } } : {}),
        ...(to ? { referenceMonth: { lte: to } } : {}),
      },
      include: { card: { select: { name: true } }, expenses: { select: { category: true, amount: true } } },
    });
    const byCategory = new Map<string, number>();
    const byCard = new Map<string, number>();
    const byMonth = new Map<string, number>();
    let total = 0;
    for (const s of statements) {
      for (const e of s.expenses) {
        const v = money(e.amount);
        total += v;
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + v);
        byCard.set(s.card.name, (byCard.get(s.card.name) ?? 0) + v);
        byMonth.set(s.referenceMonth, (byMonth.get(s.referenceMonth) ?? 0) + v);
      }
    }
    const toArr = (m: Map<string, number>) => [...m.entries()].map(([k, v]) => ({ key: k, total: round2(v) })).sort((a, b) => b.total - a.total);
    return ok(res, { total: round2(total), byCategory: toArr(byCategory), byCard: toArr(byCard), byMonth: toArr(byMonth).sort((a, b) => a.key.localeCompare(b.key)) });
  })
);

// ============================================================
// PONTO DE EQUILÍBRIO
// ============================================================

const BE_FIXED = "finance.breakeven.fixedCostMonthly";
const BE_MARGIN = "finance.breakeven.contributionMarginPct";

router.get(
  "/break-even",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const settings = await prisma.setting.findMany({ where: { key: { in: [BE_FIXED, BE_MARGIN] } } });
    const fixed = Number(settings.find((s) => s.key === BE_FIXED)?.value ?? 0);
    const marginPct = Number(settings.find((s) => s.key === BE_MARGIN)?.value ?? 0);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const rows = await prisma.financeTransaction.findMany({
      where: { organizationId: req.user!.organizationId, type: "RECEITA", status: "PAGO", date: { gte: start, lt: end } },
      select: { amount: true },
    });
    const receitaMes = round2(rows.reduce((a, r) => a + money(r.amount), 0));
    const breakEven = marginPct > 0 ? round2(fixed / (marginPct / 100)) : 0;
    return ok(res, {
      fixedCostMonthly: fixed,
      contributionMarginPct: marginPct,
      breakEvenRevenue: breakEven,
      currentMonthRevenue: receitaMes,
      gap: round2(breakEven - receitaMes),
      reached: breakEven > 0 && receitaMes >= breakEven,
    });
  })
);

router.patch(
  "/break-even",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        fixedCostMonthly: z.coerce.number().min(0).optional(),
        contributionMarginPct: z.coerce.number().min(0).max(100).optional(),
      })
      .parse(req.body);
    if (input.fixedCostMonthly !== undefined)
      await prisma.setting.upsert({ where: { key: BE_FIXED }, create: { key: BE_FIXED, value: String(input.fixedCostMonthly) }, update: { value: String(input.fixedCostMonthly) } });
    if (input.contributionMarginPct !== undefined)
      await prisma.setting.upsert({ where: { key: BE_MARGIN }, create: { key: BE_MARGIN, value: String(input.contributionMarginPct) }, update: { value: String(input.contributionMarginPct) } });
    return ok(res, { saved: true }, "Configuração salva");
  })
);

export default router;
