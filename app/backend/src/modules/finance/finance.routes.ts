import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import taxRoutes from "./tax.routes";

const router = Router();
router.use(authenticate);
router.use("/tax", taxRoutes);

const txSchema = z.object({
  type: z.enum(["RECEITA", "DESPESA"]),
  category: z.string().trim().min(1).max(120),
  amount: z.coerce.number().positive().max(1_000_000_000),
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(["PENDENTE", "PAGO"]).default("PENDENTE"),
  method: z.string().trim().max(60).optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
  clientId: z.string().min(1).optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
});

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

const include = {
  project: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

const serialize = (t: {
  id: string; type: string; category: string; amount: Prisma.Decimal; date: Date; dueDate: Date | null;
  description: string | null; status: string; paidAt: Date | null; method: string | null; createdAt: Date;
  project: { id: string; code: string; name: string } | null;
  client: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
}) => ({
  id: t.id,
  type: t.type,
  category: t.category,
  amount: money(t.amount),
  date: t.date,
  dueDate: t.dueDate,
  description: t.description,
  status: t.status,
  paidAt: t.paidAt,
  method: t.method,
  createdAt: t.createdAt,
  project: t.project,
  client: t.client,
  supplier: t.supplier,
  createdBy: t.createdBy,
});

async function validateLinks(input: { projectId?: string | null; clientId?: string | null; supplierId?: string | null }, organizationId: string) {
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } });
    if (!p) throw new BadRequestError("Projeto inválido");
  }
  if (input.clientId) {
    const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true } });
    if (!c) throw new BadRequestError("Cliente inválido");
  }
  if (input.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } });
    if (!s) throw new BadRequestError("Fornecedor inválido");
  }
}

async function audit(userId: string, action: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity: "FinanceTransaction", entityId, details } });
}

// GET /api/finance/transactions
router.get(
  "/transactions",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const q = req.query;
    const where: Prisma.FinanceTransactionWhereInput = { organizationId: req.user!.organizationId };
    if (q.type === "RECEITA" || q.type === "DESPESA") where.type = q.type;
    if (q.status === "PENDENTE" || q.status === "PAGO") where.status = q.status;
    if (q.projectId) where.projectId = String(q.projectId);
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = new Date(String(q.from));
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = new Date(String(q.to));
    }
    const rows = await prisma.financeTransaction.findMany({ where, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    return ok(res, rows.map(serialize));
  })
);

// GET /api/finance/dre?from&to[&status=PAGO|ALL]  (Demonstrativo de Resultado)
router.get(
  "/dre",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), 0, 1);
    const to = req.query.to ? new Date(String(req.query.to)) : now;
    const onlyPaid = String(req.query.status ?? "PAGO").toUpperCase() !== "ALL";

    const rows = await prisma.financeTransaction.findMany({
      where: {
        organizationId,
        date: { gte: from, lte: to },
        ...(onlyPaid ? { status: "PAGO" as const } : {}),
      },
      select: { type: true, amount: true, category: true },
    });

    const rec = new Map<string, number>();
    const desp = new Map<string, number>();
    for (const r of rows) {
      const v = money(r.amount);
      const bucket = r.type === "RECEITA" ? rec : desp;
      bucket.set(r.category, (bucket.get(r.category) ?? 0) + v);
    }
    const toList = (m: Map<string, number>) =>
      [...m.entries()].map(([categoria, valor]) => ({ categoria, valor: round2(valor) })).sort((a, b) => b.valor - a.valor);

    const totalReceitas = round2([...rec.values()].reduce((a, b) => a + b, 0));
    const totalDespesas = round2([...desp.values()].reduce((a, b) => a + b, 0));
    const resultado = round2(totalReceitas - totalDespesas);

    return ok(res, {
      periodo: { de: from.toISOString().slice(0, 10), ate: to.toISOString().slice(0, 10), base: onlyPaid ? "realizado" : "competência" },
      receitas: toList(rec),
      despesas: toList(desp),
      totalReceitas,
      totalDespesas,
      resultado,
      margem: totalReceitas > 0 ? round2((resultado / totalReceitas) * 100) : 0,
      totalLancamentos: rows.length,
    });
  })
);

// GET /api/finance/summary  (DRE simplificado + a receber/a pagar + quebras)
router.get(
  "/summary",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const range: Prisma.DateTimeFilter = {};
    if (req.query.from) range.gte = new Date(String(req.query.from));
    if (req.query.to) range.lte = new Date(String(req.query.to));
    const dateWhere = req.query.from || req.query.to ? { date: range } : {};

    const rows = await prisma.financeTransaction.findMany({
      where: { organizationId, ...dateWhere },
      select: { type: true, status: true, amount: true, category: true, date: true },
    });

    let totalReceitas = 0;
    let totalDespesas = 0;
    let aReceber = 0;
    let aPagar = 0;
    const byCategory = new Map<string, { category: string; type: string; total: number }>();
    const byMonth = new Map<string, { month: string; receitas: number; despesas: number }>();

    for (const r of rows) {
      const value = money(r.amount);
      const isReceita = r.type === "RECEITA";
      if (r.status === "PAGO") {
        if (isReceita) totalReceitas += value;
        else totalDespesas += value;
      } else {
        if (isReceita) aReceber += value;
        else aPagar += value;
      }
      const catKey = `${r.type}:${r.category}`;
      const cat = byCategory.get(catKey) ?? { category: r.category, type: r.type, total: 0 };
      cat.total += value;
      byCategory.set(catKey, cat);

      const m = r.date.toISOString().slice(0, 7);
      const mo = byMonth.get(m) ?? { month: m, receitas: 0, despesas: 0 };
      if (isReceita) mo.receitas += value;
      else mo.despesas += value;
      byMonth.set(m, mo);
    }

    return ok(res, {
      totalReceitas: round2(totalReceitas),
      totalDespesas: round2(totalDespesas),
      saldo: round2(totalReceitas - totalDespesas),
      aReceber: round2(aReceber),
      aPagar: round2(aPagar),
      totalLancamentos: rows.length,
      porCategoria: [...byCategory.values()].map((c) => ({ ...c, total: round2(c.total) })).sort((a, b) => b.total - a.total),
      porMes: [...byMonth.values()]
        .map((m) => ({ ...m, receitas: round2(m.receitas), despesas: round2(m.despesas) }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6),
    });
  })
);

// GET /api/finance/cashflow  (fluxo de caixa operacional: realizado + previsto)
router.get(
  "/cashflow",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const back = Math.min(24, Math.max(1, Number(req.query.back ?? 3)));
    const forward = Math.min(24, Math.max(1, Number(req.query.forward ?? 6)));
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + forward + 1, 1);

    const rows = await prisma.financeTransaction.findMany({
      where: { organizationId: req.user!.organizationId, OR: [{ date: { gte: first, lt: last } }, { dueDate: { gte: first, lt: last } }] },
      select: { type: true, status: true, amount: true, date: true, dueDate: true },
    });

    const buckets = new Map<string, { month: string; entradas: number; saidas: number; entradasPrevistas: number; saidasPrevistas: number }>();
    for (let d = new Date(first); d < last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, { month: key, entradas: 0, saidas: 0, entradasPrevistas: 0, saidasPrevistas: 0 });
    }

    for (const r of rows) {
      const realized = r.status === "PAGO";
      const ref = realized ? r.date : r.dueDate ?? r.date;
      const key = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.get(key);
      if (!b) continue;
      const v = money(r.amount);
      if (r.type === "RECEITA") realized ? (b.entradas += v) : (b.entradasPrevistas += v);
      else realized ? (b.saidas += v) : (b.saidasPrevistas += v);
    }

    let acumulado = 0;
    const data = [...buckets.values()].map((b) => {
      const resultado = b.entradas + b.entradasPrevistas - b.saidas - b.saidasPrevistas;
      acumulado += resultado;
      return {
        month: b.month,
        entradas: round2(b.entradas),
        saidas: round2(b.saidas),
        entradasPrevistas: round2(b.entradasPrevistas),
        saidasPrevistas: round2(b.saidasPrevistas),
        resultado: round2(resultado),
        saldoAcumulado: round2(acumulado),
      };
    });
    return ok(res, data);
  })
);

// POST /api/finance/transactions
router.post(
  "/transactions",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = txSchema.parse(req.body);
    await validateLinks(input, req.user!.organizationId);
    const t = await prisma.financeTransaction.create({
      data: {
        organizationId: req.user!.organizationId,
        type: input.type,
        category: input.category,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        date: input.date,
        dueDate: input.dueDate ?? null,
        description: input.description ?? null,
        status: input.status,
        paidAt: input.status === "PAGO" ? new Date() : null,
        method: input.method ?? null,
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        supplierId: input.supplierId ?? null,
        createdById: req.user!.id,
      },
      include,
    });
    await audit(req.user!.id, "FINANCE_TX_CREATED", t.id, { type: t.type, amount: money(t.amount) });
    return ok(res, serialize(t), "Lançamento registrado");
  })
);

// PATCH /api/finance/transactions/:id
router.patch(
  "/transactions/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.financeTransaction.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!current) throw new NotFoundError("Lançamento não encontrado");
    const input = txSchema.partial().parse(req.body);
    await validateLinks(input, req.user!.organizationId);

    const nextStatus = input.status ?? current.status;
    const t = await prisma.financeTransaction.update({
      where: { id: current.id },
      data: {
        type: input.type,
        category: input.category,
        amount: input.amount === undefined ? undefined : new Prisma.Decimal(input.amount.toFixed(2)),
        date: input.date,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate,
        description: input.description === undefined ? undefined : input.description,
        method: input.method === undefined ? undefined : input.method,
        status: input.status,
        paidAt: nextStatus === "PAGO" ? current.paidAt ?? new Date() : null,
        projectId: input.projectId === undefined ? undefined : input.projectId,
        clientId: input.clientId === undefined ? undefined : input.clientId,
        supplierId: input.supplierId === undefined ? undefined : input.supplierId,
      },
      include,
    });
    await audit(req.user!.id, "FINANCE_TX_UPDATED", t.id, { status: t.status });
    return ok(res, serialize(t), "Lançamento atualizado");
  })
);

// DELETE /api/finance/transactions/:id
router.delete(
  "/transactions/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.financeTransaction.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!current) throw new NotFoundError("Lançamento não encontrado");
    await prisma.financeTransaction.delete({ where: { id: current.id } });
    await audit(req.user!.id, "FINANCE_TX_DELETED", current.id);
    return ok(res, { id: current.id }, "Lançamento removido");
  })
);

export default router;
