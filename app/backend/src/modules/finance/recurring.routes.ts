/**
 * Despesas/receitas fixas (geram uma parcela por mês) e solicitações de
 * débito/crédito (quem não mexe no financeiro pede; o financeiro aprova).
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { notifyUser, notifyUsersWithPermission } from "../../lib/notify";
import { monthKey, monthsToGenerate } from "./recurring.rules";

const router = Router();
router.use(authenticate);

const D = (n: number) => new Prisma.Decimal(n.toFixed(2));
const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");

/** Lança os meses que faltam de um modelo (idempotente por modelo + mês). */
export async function generateRecurring(recurringId: string, fromMonth: string, count: number, userId: string | null) {
  const t = await prisma.financeRecurring.findUniqueOrThrow({ where: { id: recurringId } });
  const existing = new Set(
    (await prisma.financeTransaction.findMany({ where: { recurringId }, select: { recurringMonth: true } })).map((e) => e.recurringMonth!).filter(Boolean)
  );
  const plan = monthsToGenerate(t, fromMonth, count, existing);
  if (!plan.length) return 0;
  const r = await prisma.financeTransaction.createMany({
    data: plan.map((p) => ({
      organizationId: t.organizationId,
      type: t.type,
      category: t.category,
      amount: t.amount,
      date: new Date(`${p.dueDay}T00:00:00.000Z`),
      dueDate: new Date(`${p.dueDay}T00:00:00.000Z`),
      description: `${t.description} (${p.month.split("-").reverse().join("/")})`,
      status: "PENDENTE" as const,
      method: t.method,
      supplierId: t.supplierId,
      costCenterId: t.costCenterId,
      recurringId: t.id,
      recurringMonth: p.month,
      createdById: userId,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Job diário: cada modelo ativo tem sempre o mês atual e os 2 seguintes lançados. */
export async function runRecurringGeneration(now = new Date()) {
  const templates = await prisma.financeRecurring.findMany({ where: { active: true }, select: { id: true } });
  let created = 0;
  for (const t of templates) created += await generateRecurring(t.id, monthKey(now), 3, null);
  return { templates: templates.length, created };
}

// ------------------------------------------------------------------ fixas

const recurringSchema = z.object({
  type: z.enum(["DESPESA", "RECEITA"]).default("DESPESA"),
  description: z.string().trim().min(2).max(200),
  category: z.string().trim().min(1).max(120),
  amount: z.coerce.number().positive().max(100_000_000),
  dayOfMonth: z.coerce.number().int().min(1).max(31),
  startMonth: month,
  endMonth: month.optional().nullable().or(z.literal("")),
  method: z.string().trim().max(60).optional().nullable(),
  supplierId: z.string().optional().nullable(),
  costCenterId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

async function checkRecurringRefs(orgId: string, input: { supplierId?: string | null; costCenterId?: string | null }) {
  if (input.supplierId && !(await prisma.supplier.findFirst({ where: { id: input.supplierId }, select: { id: true } }))) throw new BadRequestError("Fornecedor inválido");
  if (input.costCenterId && !(await prisma.costCenter.findFirst({ where: { id: input.costCenterId, organizationId: orgId }, select: { id: true } }))) throw new BadRequestError("Centro de custo inválido");
}

router.get(
  "/recurring",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.financeRecurring.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: [{ active: "desc" }, { description: "asc" }],
      include: { entries: { select: { recurringMonth: true, status: true, dueDate: true }, orderBy: { recurringMonth: "asc" } } },
    });
    const today = monthKey(new Date());
    return ok(
      res,
      rows.map(({ entries, ...r }) => ({
        ...r,
        amount: n(r.amount),
        generated: entries.length,
        paid: entries.filter((e) => e.status === "PAGO").length,
        nextOpen: entries.find((e) => e.status === "PENDENTE" && (e.recurringMonth ?? "") >= today)?.dueDate ?? null,
        lastMonth: entries.at(-1)?.recurringMonth ?? null,
      }))
    );
  })
);

router.post(
  "/recurring",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = recurringSchema.parse(req.body);
    await checkRecurringRefs(req.user!.organizationId, input);
    if (input.endMonth && input.endMonth < input.startMonth) throw new BadRequestError("O fim vem antes do início");
    const t = await prisma.financeRecurring.create({
      data: { ...input, endMonth: input.endMonth || null, amount: D(input.amount), organizationId: req.user!.organizationId, createdById: req.user!.id },
    });
    const created = await generateRecurring(t.id, monthKey(new Date()), 3, req.user!.id);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "FINANCE_RECURRING_CREATED", entity: "FinanceRecurring", entityId: t.id, details: { description: t.description, amount: input.amount } } });
    return ok(res, t, `Lançamento fixo criado — ${created} parcela(s) já no financeiro`);
  })
);

// PUT /recurring/:id — muda o modelo; parcelas pendentes futuras acompanham o valor/categoria novos
router.put(
  "/recurring/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.financeRecurring.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Lançamento fixo não encontrado");
    const input = recurringSchema.parse(req.body);
    await checkRecurringRefs(req.user!.organizationId, input);
    const today = monthKey(new Date());
    const [t, updated] = await prisma.$transaction([
      prisma.financeRecurring.update({ where: { id: cur.id }, data: { ...input, endMonth: input.endMonth || null, amount: D(input.amount) } }),
      prisma.financeTransaction.updateMany({
        where: { recurringId: cur.id, status: "PENDENTE", paidAmount: 0, recurringMonth: { gte: today } },
        data: { amount: D(input.amount), category: input.category, method: input.method ?? null, supplierId: input.supplierId ?? null, costCenterId: input.costCenterId ?? null },
      }),
    ]);
    // desativado ou com fim antes: as parcelas futuras não pagas saem
    const removed = await prisma.financeTransaction.deleteMany({
      where: {
        recurringId: cur.id,
        status: "PENDENTE",
        paidAmount: 0,
        recurringMonth: { gte: today },
        ...(input.active === false ? {} : input.endMonth ? { recurringMonth: { gt: input.endMonth } } : { id: "__nenhum__" }),
      },
    });
    const created = input.active === false ? 0 : await generateRecurring(cur.id, today, 3, req.user!.id);
    return ok(res, t, `Atualizado — ${updated.count} parcela(s) pendente(s) ajustada(s)${removed.count ? `, ${removed.count} removida(s)` : ""}${created ? `, ${created} nova(s)` : ""}`);
  })
);

// POST /recurring/:id/generate { months } — lança adiantado (ex.: o ano todo)
router.post(
  "/recurring/:id/generate",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.financeRecurring.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Lançamento fixo não encontrado");
    if (!cur.active) throw new BadRequestError("Lançamento fixo inativo");
    const { months } = z.object({ months: z.coerce.number().int().min(1).max(36) }).parse(req.body);
    const created = await generateRecurring(cur.id, monthKey(new Date()), months, req.user!.id);
    return ok(res, { created }, created ? `${created} parcela(s) lançada(s)` : "Esses meses já estavam lançados");
  })
);

// ------------------------------------------------------------------ solicitações

const canDecide = (req: Request) => req.user!.permissions.includes("finance.manage");

router.get(
  "/requests",
  requireAnyPermission(["finance.request", "finance.manage"]),
  asyncHandler(async (req, res) => {
    const status = z.enum(["PENDENTE", "APROVADA", "RECUSADA"]).optional().parse(req.query.status || undefined);
    const rows = await prisma.financeRequest.findMany({
      where: { organizationId: req.user!.organizationId, ...(status ? { status } : {}), ...(canDecide(req) ? {} : { requestedById: req.user!.id }) },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const people = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
    const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
    return ok(res, rows.map((r) => ({ ...r, amount: n(r.amount), requestedBy: name(r.requestedById), decidedBy: name(r.decidedById) })));
  })
);

router.post(
  "/requests",
  requireAnyPermission(["finance.request", "finance.manage"]),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        type: z.enum(["DESPESA", "RECEITA"]),
        description: z.string().trim().min(3).max(500),
        category: z.string().trim().max(120).optional().nullable(),
        amount: z.coerce.number().positive().max(100_000_000),
        dueDate: z.coerce.date().optional().nullable(),
        supplierName: z.string().trim().max(160).optional().nullable(),
        projectId: z.string().optional().nullable(),
        clientId: z.string().optional().nullable(),
      })
      .parse(req.body);
    const r = await prisma.financeRequest.create({
      data: { ...input, amount: D(input.amount), organizationId: req.user!.organizationId, requestedById: req.user!.id, category: input.category || null, projectId: input.projectId || null, clientId: input.clientId || null },
    });
    await notifyUsersWithPermission({
      organizationId: req.user!.organizationId,
      permission: "finance.manage",
      title: input.type === "DESPESA" ? "Solicitação de pagamento" : "Solicitação de recebimento",
      message: `${req.user!.name}: ${input.description} — R$ ${input.amount.toFixed(2).replace(".", ",")}`,
      excludeUserId: req.user!.id,
    });
    return ok(res, r, "Solicitação enviada ao financeiro");
  })
);

// POST /requests/:id/decide { decision, note, category?, dueDate? }
router.post(
  "/requests/:id/decide",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional().nullable(), category: z.string().trim().max(120).optional().nullable(), dueDate: z.coerce.date().optional().nullable() })
      .parse(req.body);
    const cur = await prisma.financeRequest.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Solicitação não encontrada");
    if (cur.status !== "PENDENTE") throw new BadRequestError("Solicitação já decidida");
    if (input.decision === "REJECT" && !input.note) throw new BadRequestError("Diga o motivo da recusa");
    const category = input.category || cur.category || (cur.type === "DESPESA" ? "Outras despesas" : "Outras receitas");
    const updated = await prisma.$transaction(async (tx) => {
      let transactionId: string | null = null;
      if (input.decision === "APPROVE") {
        const due = input.dueDate ?? cur.dueDate ?? new Date();
        const t = await tx.financeTransaction.create({
          data: {
            organizationId: cur.organizationId,
            type: cur.type,
            category,
            amount: cur.amount,
            date: new Date(),
            dueDate: due,
            description: `${cur.description}${cur.supplierName ? ` — ${cur.supplierName}` : ""} (solicitação)`,
            status: "PENDENTE",
            projectId: cur.projectId,
            clientId: cur.clientId,
            createdById: req.user!.id,
          },
        });
        transactionId = t.id;
      }
      return tx.financeRequest.update({
        where: { id: cur.id },
        data: { status: input.decision === "APPROVE" ? "APROVADA" : "RECUSADA", decidedById: req.user!.id, decidedAt: new Date(), decisionNote: input.note || null, transactionId, category },
      });
    });
    await notifyUser(
      cur.requestedById,
      input.decision === "APPROVE" ? "Solicitação aprovada" : "Solicitação recusada",
      `${cur.description}${input.note ? ` — ${input.note}` : ""}`
    );
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: input.decision === "APPROVE" ? "FINANCE_REQUEST_APPROVED" : "FINANCE_REQUEST_REJECTED", entity: "FinanceRequest", entityId: cur.id } });
    return ok(res, updated, input.decision === "APPROVE" ? "Aprovada — lançamento criado no financeiro" : "Solicitação recusada");
  })
);

export default router;
