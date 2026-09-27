import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { csvFileName, toCsv, type CsvColumn } from "../../utils/csv";
import taxRoutes from "./tax.routes";
import extrasRoutes from "./extras.routes";
import documentsRoutes from "./documents.routes";
import { DRE_LINE_KEYS, DRE_LINE_LABEL, buildDre } from "./dre.service";

const router = Router();
router.use(authenticate);
router.use("/tax", taxRoutes);
router.use("/documents", documentsRoutes);
router.use("/", extrasRoutes);

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
  costCenterId: z.string().min(1).optional().nullable(),
});

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

const include = {
  project: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

const serialize = (t: {
  id: string; type: string; category: string; amount: Prisma.Decimal; date: Date; dueDate: Date | null;
  description: string | null; status: string; paidAt: Date | null; method: string | null; createdAt: Date;
  project: { id: string; code: string; name: string } | null;
  client: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  costCenter: { id: string; code: string; name: string } | null;
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
  costCenter: t.costCenter,
  createdBy: t.createdBy,
});

async function validateLinks(
  input: { projectId?: string | null; clientId?: string | null; supplierId?: string | null; costCenterId?: string | null },
  organizationId: string
) {
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
  if (input.costCenterId) {
    // centro inativo continua válido em lançamento antigo, mas não entra em um novo
    const cc = await prisma.costCenter.findFirst({
      where: { id: input.costCenterId, organizationId, active: true },
      select: { id: true },
    });
    if (!cc) throw new BadRequestError("Centro de custo inválido ou inativo");
  }
}

async function audit(userId: string, action: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity: "FinanceTransaction", entityId, details } });
}

// ============================================================
// §31 — CENTROS DE CUSTO
//
// Terceira dimensão do lançamento, ao lado de `category` (a natureza do gasto)
// e `projectId` (a obra). Responde "quanto cada setor gastou".
// ============================================================

const costCenterSchema = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  active: z.boolean().default(true),
});

// GET /api/finance/cost-centers?all=1
router.get(
  "/cost-centers",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    // por padrão só os ativos: o formulário não deve oferecer centro desativado
    const todos = String(req.query.all ?? "") === "1";
    const rows = await prisma.costCenter.findMany({
      where: { organizationId: req.user!.organizationId, ...(todos ? {} : { active: true }) },
      orderBy: { name: "asc" },
    });
    return ok(res, rows);
  })
);

// POST /api/finance/cost-centers
router.post(
  "/cost-centers",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = costCenterSchema.parse(req.body);
    const existe = await prisma.costCenter.findFirst({
      where: { organizationId: req.user!.organizationId, code: input.code },
      select: { id: true, name: true },
    });
    if (existe) throw new BadRequestError(`Já existe um centro com o código ${input.code} (${existe.name})`);
    const cc = await prisma.costCenter.create({
      data: {
        organizationId: req.user!.organizationId,
        code: input.code,
        name: input.name,
        description: input.description || null,
        active: input.active,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "COST_CENTER_CREATED", entity: "CostCenter", entityId: cc.id, details: { code: cc.code } },
    });
    return ok(res, cc, "Centro de custo criado");
  })
);

// PATCH /api/finance/cost-centers/:id
router.patch(
  "/cost-centers/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const atual = await prisma.costCenter.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!atual) throw new NotFoundError("Centro de custo não encontrado");
    const input = costCenterSchema.partial().parse(req.body);
    if (input.code && input.code !== atual.code) {
      const conflito = await prisma.costCenter.findFirst({
        where: { organizationId: req.user!.organizationId, code: input.code, id: { not: atual.id } },
        select: { id: true },
      });
      if (conflito) throw new BadRequestError(`Já existe um centro com o código ${input.code}`);
    }
    const cc = await prisma.costCenter.update({
      where: { id: atual.id },
      data: {
        code: input.code,
        name: input.name,
        description: input.description === undefined ? undefined : input.description || null,
        active: input.active,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "COST_CENTER_UPDATED", entity: "CostCenter", entityId: cc.id },
    });
    return ok(res, cc, "Centro de custo atualizado");
  })
);

// DELETE /api/finance/cost-centers/:id — desativa; não apaga histórico
router.delete(
  "/cost-centers/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const atual = await prisma.costCenter.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true, code: true, _count: { select: { transactions: true } } },
    });
    if (!atual) throw new NotFoundError("Centro de custo não encontrado");

    // Com lançamentos, apagar tiraria a classificação de tudo que já passou.
    if (atual._count.transactions > 0) {
      const cc = await prisma.costCenter.update({ where: { id: atual.id }, data: { active: false } });
      return ok(res, cc, `Centro desativado (${atual._count.transactions} lançamento(s) mantêm o histórico)`);
    }
    await prisma.costCenter.delete({ where: { id: atual.id } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "COST_CENTER_DELETED", entity: "CostCenter", entityId: atual.id, details: { code: atual.code } },
    });
    return ok(res, { deleted: true }, "Centro de custo excluído");
  })
);

// GET /api/finance/transactions.csv — mesmos filtros da listagem (§59)
router.get(
  "/transactions.csv",
  requirePermission("reports.export"),
  asyncHandler(async (req, res) => {
    const q = req.query;
    const where: Prisma.FinanceTransactionWhereInput = { organizationId: req.user!.organizationId };
    if (q.type === "RECEITA" || q.type === "DESPESA") where.type = q.type;
    if (q.status === "PENDENTE" || q.status === "PAGO") where.status = q.status;
    if (q.projectId) where.projectId = String(q.projectId);
    if (q.costCenterId) where.costCenterId = String(q.costCenterId);
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = new Date(String(q.from));
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = new Date(String(q.to));
    }

    const rows = await prisma.financeTransaction.findMany({ where, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    type Row = (typeof rows)[number];

    const colunas: CsvColumn<Row>[] = [
      { header: "Data", value: (r) => r.date },
      { header: "Vencimento", value: (r) => r.dueDate },
      { header: "Tipo", value: (r) => (r.type === "RECEITA" ? "Receita" : "Despesa") },
      { header: "Categoria", value: (r) => r.category },
      { header: "Descrição", value: (r) => r.description },
      // sinal negativo na despesa: somar a coluna no Excel já dá o saldo
      { header: "Valor", value: (r) => (r.type === "DESPESA" ? -money(r.amount) : money(r.amount)) },
      { header: "Status", value: (r) => (r.status === "PAGO" ? "Pago" : "Pendente") },
      { header: "Pago em", value: (r) => r.paidAt },
      { header: "Forma", value: (r) => r.method },
      { header: "Centro de custo", value: (r) => (r.costCenter ? `${r.costCenter.code} - ${r.costCenter.name}` : null) },
      { header: "Projeto", value: (r) => (r.project ? `${r.project.code} - ${r.project.name}` : null) },
      { header: "Cliente", value: (r) => r.client?.name },
      { header: "Fornecedor", value: (r) => r.supplier?.name },
      { header: "Lançado por", value: (r) => r.createdBy?.name },
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${csvFileName("lancamentos-financeiros")}"`);
    return res.send(toCsv(rows, colunas));
  })
);

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
    if (q.costCenterId) where.costCenterId = String(q.costCenterId);
    if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = new Date(String(q.from));
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = new Date(String(q.to));
    }
    const rows = await prisma.financeTransaction.findMany({ where, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    return ok(res, rows.map(serialize));
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
      select: {
        type: true, status: true, amount: true, category: true, date: true,
        costCenter: { select: { id: true, code: true, name: true } },
      },
    });

    let totalReceitas = 0;
    let totalDespesas = 0;
    let aReceber = 0;
    let aPagar = 0;
    const byCategory = new Map<string, { category: string; type: string; total: number }>();
    const byMonth = new Map<string, { month: string; receitas: number; despesas: number }>();
    // §31: quanto cada setor consumiu. "(sem centro)" evita esconder o que
    // ninguém classificou — é justamente o que precisa ser revisado.
    const byCostCenter = new Map<string, { id: string | null; code: string; name: string; receitas: number; despesas: number }>();

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

      const ccKey = r.costCenter?.id ?? "";
      const cc = byCostCenter.get(ccKey) ?? {
        id: r.costCenter?.id ?? null,
        code: r.costCenter?.code ?? "—",
        name: r.costCenter?.name ?? "(sem centro de custo)",
        receitas: 0,
        despesas: 0,
      };
      if (isReceita) cc.receitas += value;
      else cc.despesas += value;
      byCostCenter.set(ccKey, cc);

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
      porCentroDeCusto: [...byCostCenter.values()]
        .map((c) => ({ ...c, receitas: round2(c.receitas), despesas: round2(c.despesas) }))
        .sort((a, b) => b.despesas - a.despesas),
      porMes: [...byMonth.values()]
        .map((m) => ({ ...m, receitas: round2(m.receitas), despesas: round2(m.despesas) }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6),
    });
  })
);

// GET /api/finance/dre/lines  -> chaves e rótulos das linhas da DRE (para a UI)
router.get(
  "/dre/lines",
  requirePermission("finance.read"),
  asyncHandler(async (_req, res) => ok(res, DRE_LINE_KEYS.map((key) => ({ key, label: DRE_LINE_LABEL[key] }))))
);

// GET /api/finance/dre/mappings  -> mapeamentos categoria -> linha da DRE
router.get(
  "/dre/mappings",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.dreCategoryMapping.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { category: "asc" },
      select: { category: true, dreLine: true },
    });
    return ok(res, rows);
  })
);

// PUT /api/finance/dre/mappings  { mappings: [{category, dreLine}] }  -> substitui todos
router.put(
  "/dre/mappings",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        mappings: z
          .array(z.object({ category: z.string().trim().min(1).max(120), dreLine: z.enum(DRE_LINE_KEYS) }))
          .max(500),
      })
      .parse(req.body);
    const orgId = req.user!.organizationId;
    // dedup por categoria (último vence)
    const map = new Map(input.mappings.map((m) => [m.category, m.dreLine]));
    await prisma.$transaction([
      prisma.dreCategoryMapping.deleteMany({ where: { organizationId: orgId } }),
      prisma.dreCategoryMapping.createMany({
        data: [...map.entries()].map(([category, dreLine]) => ({ organizationId: orgId, category, dreLine })),
      }),
    ]);
    return ok(res, { count: map.size }, "Classificação da DRE salva");
  })
);

// GET /api/finance/dre?from&to&basis=accrual|cash  -> DRE formal
router.get(
  "/dre",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const basis = req.query.basis === "cash" ? "cash" : "accrual";
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const dateField = basis === "cash" ? "paidAt" : "date";
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    const where: Prisma.FinanceTransactionWhereInput = { organizationId };
    if (from || to) where[dateField] = range;
    if (basis === "cash") where.status = "PAGO";

    const [txs, mappingRows] = await Promise.all([
      prisma.financeTransaction.findMany({ where, select: { type: true, category: true, amount: true, status: true } }),
      prisma.dreCategoryMapping.findMany({ where: { organizationId }, select: { category: true, dreLine: true } }),
    ]);

    const mappings = Object.fromEntries(mappingRows.map((m) => [m.category, m.dreLine]));
    const dre = buildDre(txs, mappings);
    return ok(res, {
      from: from ? from.toISOString().slice(0, 10) : null,
      to: to ? to.toISOString().slice(0, 10) : null,
      basis,
      transactionCount: txs.length,
      ...dre,
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
        costCenterId: input.costCenterId ?? null,
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
        costCenterId: input.costCenterId === undefined ? undefined : input.costCenterId,
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
