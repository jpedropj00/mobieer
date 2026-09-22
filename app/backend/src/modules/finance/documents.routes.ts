/**
 * Documentos financeiros: /api/finance/documents
 *
 * Boleto, fatura, nota fiscal, recibo e outros — com pagamento parcial,
 * anexo do documento e do comprovante, visão de vencimentos por dia/semana/mês
 * e painel de contas a pagar.
 *
 * Trabalha sobre FinanceTransaction, a mesma tabela que já alimenta DRE, fluxo
 * de caixa e cartões. As rotas antigas (/api/finance/transactions) continuam
 * valendo; estas acrescentam a camada de documento sem tirar nada.
 *
 * Regra do saldo: `paidAmount` é sempre recalculado da soma dos pagamentos
 * dentro da transação, nunca incrementado — assim um estorno ou uma corrida
 * entre dois caixas não deixa o documento com valor errado.
 */
import { Router } from "express";
import { z } from "zod";
import { FinanceAttachmentKind, FinanceDocType, FinanceStatus, FinanceType, Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { buildStorageKey, storage } from "../../lib/storage";
import { notifyUser } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { dateQuery, enumQuery, intQuery, queryString } from "../../utils/query";
import { ok } from "../../utils/response";
import { pipeToResponse } from "../../utils/stream";
import {
  ALERT_DAY_OPTIONS,
  DEFAULT_ALERT_DAYS,
  FINANCE_SITUATIONS,
  SITUATION_LABEL,
  assertPayable,
  assertPaymentAmount,
  type DueGrouping,
  type FinanceSituation,
  financeSituation,
  groupByDue,
  isOpen,
  normalizeAlertDays,
  remainingBalance,
  statusAfterPayments,
} from "./documents.service";
import { issueReceipt } from "./receipt.service";

const router = Router();
router.use(authenticate);

// Quem já tinha acesso ao financeiro continua tendo: as permissões novas são
// mais específicas, mas finance.read/finance.manage seguem valendo.
const canRead = requireAnyPermission(["finance.documents.read", "finance.read"]);
const canManage = requireAnyPermission(["finance.documents.manage", "finance.manage"]);
const canPay = requireAnyPermission(["finance.documents.pay", "finance.manage"]);

const ALERT_SETTING_KEY = "financeAlertDays";

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

const clean = (max: number) => z.string().trim().max(max);

// Caracteres de controle sujam PDF e planilha exportados, e servem para
// esconder conteúdo dentro de um campo. Saem de todo texto livre que entra.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
/** Texto opcional: sem caracteres de controle e com vazio virando null. */
const txt = <T extends string | null | undefined>(v: T) => (typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim() || null : (v ?? null));
/** Texto obrigatório já validado pelo schema. */
const txtReq = (v: string) => v.replace(CONTROL_CHARS, "").trim();

async function orgAlertDays(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: ALERT_SETTING_KEY } });
  return normalizeAlertDays(row?.value, DEFAULT_ALERT_DAYS);
}

async function audit(userId: string, action: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity: "FinanceTransaction", entityId, details } });
}

const include = {
  project: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  related: { select: { id: true, docType: true, docNumber: true, amount: true, dueDate: true } },
  _count: { select: { payments: true, attachments: true } },
} satisfies Prisma.FinanceTransactionInclude;

type DocRow = Prisma.FinanceTransactionGetPayload<{ include: typeof include }>;

function serialize(t: DocRow, alertDays: number, now = new Date()) {
  const amount = money(t.amount);
  const paidAmount = money(t.paidAmount);
  const situation = financeSituation(t, alertDays, now);
  return {
    id: t.id,
    type: t.type,
    docType: t.docType,
    docNumber: t.docNumber,
    category: t.category,
    amount,
    paidAmount,
    remaining: remainingBalance(amount, paidAmount),
    issueDate: t.issueDate,
    date: t.date,
    dueDate: t.dueDate,
    paidAt: t.paidAt,
    method: t.method,
    status: t.status,
    situation,
    situationLabel: SITUATION_LABEL[situation],
    alertDays: t.alertDays ?? alertDays,
    alertDaysCustom: t.alertDays !== null,
    description: t.description,
    notes: t.notes,
    purchaseRef: t.purchaseRef,
    project: t.project,
    client: t.client,
    supplier: t.supplier,
    responsible: t.responsible,
    createdBy: t.createdBy,
    related: t.related ? { ...t.related, amount: money(t.related.amount) } : null,
    paymentCount: t._count.payments,
    attachmentCount: t._count.attachments,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const docInput = z.object({
  type: z.nativeEnum(FinanceType).default(FinanceType.DESPESA),
  docType: z.nativeEnum(FinanceDocType).default(FinanceDocType.OUTROS),
  docNumber: clean(80).optional().nullable(),
  category: clean(120).min(1, "Informe a categoria"),
  amount: z.coerce.number().positive("O valor precisa ser maior que zero").max(1_000_000_000),
  issueDate: z.coerce.date().optional().nullable(),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional().nullable(),
  method: clean(60).optional().nullable(),
  description: clean(5000).optional().nullable(),
  notes: clean(5000).optional().nullable(),
  purchaseRef: clean(120).optional().nullable(),
  alertDays: z.coerce.number().int().refine((n) => (ALERT_DAY_OPTIONS as readonly number[]).includes(n), "Use 1, 3, 5 ou 7 dias").optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
  clientId: z.string().min(1).optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
  responsibleId: z.string().min(1).optional().nullable(),
  relatedId: z.string().min(1).optional().nullable(),
});

/**
 * Confere que cada vínculo existe e é da mesma organização. Sem isso alguém
 * poderia apontar um documento para o fornecedor ou o projeto de outra loja.
 */
async function validateLinks(input: Partial<z.infer<typeof docInput>>, organizationId: string, selfId?: string) {
  if (input.supplierId) {
    const s = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } });
    if (!s) throw new BadRequestError("Fornecedor inválido");
  }
  if (input.clientId) {
    const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId }, select: { id: true } });
    if (!c) throw new BadRequestError("Cliente inválido");
  }
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } });
    if (!p) throw new BadRequestError("Projeto inválido");
  }
  if (input.responsibleId) {
    const u = await prisma.user.findFirst({ where: { id: input.responsibleId, organizationId }, select: { id: true } });
    if (!u) throw new BadRequestError("Responsável inválido");
  }
  if (input.relatedId) {
    if (input.relatedId === selfId) throw new ValidationError("Um documento não pode se vincular a ele mesmo");
    const r = await prisma.financeTransaction.findFirst({ where: { id: input.relatedId, organizationId }, select: { id: true } });
    if (!r) throw new BadRequestError("Documento vinculado inválido");
  }
}

/** Documento da organização do usuário, ou 404. */
async function loadDoc(id: string, organizationId: string) {
  const doc = await prisma.financeTransaction.findFirst({ where: { id, organizationId }, include });
  if (!doc) throw new NotFoundError("Documento não encontrado");
  return doc;
}

/**
 * Recalcula `paidAmount`, `status` e `paidAt` a partir dos pagamentos gravados.
 * Roda dentro da transação que criou ou apagou o pagamento.
 */
async function recalc(tx: Prisma.TransactionClient, transactionId: string) {
  const doc = await tx.financeTransaction.findUniqueOrThrow({ where: { id: transactionId }, select: { amount: true, status: true } });
  const agg = await tx.financePayment.aggregate({ where: { transactionId }, _sum: { amount: true }, _max: { paidAt: true } });
  const paid = round2(money(agg._sum.amount));
  // documento cancelado continua cancelado: o estorno não o reabre sozinho
  const status = doc.status === FinanceStatus.CANCELADO ? FinanceStatus.CANCELADO : statusAfterPayments(money(doc.amount), paid);
  return tx.financeTransaction.update({
    where: { id: transactionId },
    data: { paidAmount: dec(paid), status, paidAt: status === FinanceStatus.PAGO ? agg._max.paidAt : null },
    select: { id: true, status: true, paidAmount: true, amount: true },
  });
}

// ===========================================================================
// Rotas de caminho fixo vêm antes de /:id, senão "due" e "dashboard" viram id
// ===========================================================================

/** Opções que a tela usa para montar filtros e formulários. */
router.get(
  "/options",
  canRead,
  asyncHandler(async (_req, res) =>
    ok(res, {
      docTypes: Object.values(FinanceDocType),
      situations: FINANCE_SITUATIONS.map((s) => ({ value: s, label: SITUATION_LABEL[s] })),
      alertDayOptions: [...ALERT_DAY_OPTIONS],
      defaultAlertDays: await orgAlertDays(),
    })
  )
);

// GET/PUT da antecedência padrão do alerta
router.get("/alert-days", canRead, asyncHandler(async (_req, res) => ok(res, { alertDays: await orgAlertDays(), options: [...ALERT_DAY_OPTIONS] })));

router.put(
  "/alert-days",
  requireAnyPermission(["finance.documents.manage", "settings.manage"]),
  asyncHandler(async (req, res) => {
    const { alertDays } = z
      .object({ alertDays: z.coerce.number().int().refine((n) => (ALERT_DAY_OPTIONS as readonly number[]).includes(n), "Use 1, 3, 5 ou 7 dias") })
      .parse(req.body);
    await prisma.setting.upsert({
      where: { key: ALERT_SETTING_KEY },
      create: { key: ALERT_SETTING_KEY, value: String(alertDays) },
      update: { value: String(alertDays) },
    });
    await audit(req.user!.id, "FINANCE_ALERT_DAYS_CHANGED", ALERT_SETTING_KEY, { alertDays });
    return ok(res, { alertDays }, `Alerta passa a avisar ${alertDays} dia(s) antes do vencimento`);
  })
);

/** Filtros compartilhados entre a lista, a visão de vencimentos e o painel. */
function buildWhere(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]): Prisma.FinanceTransactionWhereInput {
  const q = req.query;
  const where: Prisma.FinanceTransactionWhereInput = { organizationId: req.user!.organizationId };

  const type = enumQuery(q.type, FinanceType, "tipo");
  if (type) where.type = type;
  const docType = enumQuery(q.docType, FinanceDocType, "tipo de documento");
  if (docType) where.docType = docType;
  if (q.supplierId) where.supplierId = String(q.supplierId);
  if (q.clientId) where.clientId = String(q.clientId);
  if (q.projectId) where.projectId = String(q.projectId);
  if (q.responsibleId) where.responsibleId = String(q.responsibleId);
  const category = queryString(q.category);
  if (category) where.category = { equals: category, mode: "insensitive" };

  const from = dateQuery(q.from, "data inicial");
  const to = dateQuery(q.to, "data final");
  if (from || to) {
    // o período filtra por vencimento: é a pergunta que a tela faz ("o que vence entre...")
    where.dueDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  const search = queryString(q.q);
  if (search) {
    where.OR = [
      { docNumber: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
      { purchaseRef: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  return where;
}

/** A situação é derivada, então o filtro por ela acontece depois da consulta. */
function filterBySituation<T extends { situation: FinanceSituation }>(rows: T[], raw: unknown): T[] {
  const wanted = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is FinanceSituation => (FINANCE_SITUATIONS as readonly string[]).includes(s));
  return wanted.length ? rows.filter((r) => wanted.includes(r.situation)) : rows;
}

// GET /api/finance/documents — lista, do vencimento mais próximo para o mais distante
router.get(
  "/",
  canRead,
  asyncHandler(async (req, res) => {
    const alertDays = await orgAlertDays();
    const rows = await prisma.financeTransaction.findMany({
      where: buildWhere(req),
      include,
      // vencimento mais próximo primeiro; o que não tem vencimento vai para o fim
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: intQuery(req.query.limit, { min: 1, max: 500, name: "limit" }) ?? 200,
    });
    const items = filterBySituation(rows.map((r) => serialize(r, alertDays)), req.query.situation);
    return ok(res, {
      items,
      totals: {
        count: items.length,
        amount: round2(items.reduce((s, i) => s + i.amount, 0)),
        remaining: round2(items.reduce((s, i) => s + i.remaining, 0)),
      },
    });
  })
);

// GET /api/finance/documents/due?grouping=day|week|month — calendário de vencimentos
router.get(
  "/due",
  canRead,
  asyncHandler(async (req, res) => {
    const grouping = (["day", "week", "month"].includes(String(req.query.grouping)) ? req.query.grouping : "week") as DueGrouping;
    const alertDays = await orgAlertDays();
    const where = buildWhere(req);
    // esta visão é só sobre o que tem vencimento; preserva o período já filtrado
    const period = (where.dueDate ?? {}) as Prisma.DateTimeNullableFilter;
    const rows = await prisma.financeTransaction.findMany({
      where: { ...where, dueDate: { ...period, not: null } },
      include,
      orderBy: [{ dueDate: "asc" }],
      take: 1000,
    });
    const items = filterBySituation(rows.map((r) => serialize(r, alertDays)), req.query.situation);
    const groups = groupByDue(
      items.map((i) => ({ ...i, dueDate: i.dueDate as Date })),
      grouping
    );
    return ok(res, {
      grouping,
      alertDays,
      groups: groups.map((g) => ({ bucket: g.bucket, total: g.total, remaining: g.remaining, count: g.items.length, items: g.items })),
    });
  })
);

// GET /api/finance/documents/dashboard — a pagar, pago, vencido, a vencer + quebras
router.get(
  "/dashboard",
  canRead,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const alertDays = await orgAlertDays();
    const from = dateQuery(req.query.from, "data inicial");
    const to = dateQuery(req.query.to, "data final");
    const now = new Date();

    const rows = await prisma.financeTransaction.findMany({
      where: {
        organizationId,
        ...(enumQuery(req.query.type, FinanceType, "tipo") ? { type: enumQuery(req.query.type, FinanceType, "tipo")! } : {}),
      },
      select: {
        id: true, type: true, docType: true, category: true, amount: true, paidAmount: true,
        status: true, dueDate: true, alertDays: true, paidAt: true, date: true,
        supplier: { select: { id: true, name: true } },
      },
    });

    const inPeriod = (d: Date | null) => !d || ((!from || d >= from) && (!to || d <= to));

    let totalAPagar = 0;
    let totalPago = 0;
    let totalVencido = 0;
    let totalAVencer = 0;
    const porCategoria = new Map<string, { category: string; total: number; remaining: number; count: number }>();
    const porFornecedor = new Map<string, { supplierId: string | null; supplier: string; total: number; remaining: number; count: number }>();
    const porTipo = new Map<string, { docType: string; total: number; remaining: number; count: number }>();
    const movimentacoes: { id: string; category: string; amount: number; date: Date | null; kind: "PAGO" | "EM_ABERTO" }[] = [];

    for (const r of rows) {
      const amount = money(r.amount);
      const paid = money(r.paidAmount);
      const remaining = remainingBalance(amount, paid);
      const situation = financeSituation(r, alertDays, now);

      // o painel olha o vencimento para o que está em aberto e o pagamento para o que saiu
      const refDate = isOpen(r.status) ? r.dueDate : r.paidAt ?? r.date;
      if (!inPeriod(refDate)) continue;

      if (situation === "CANCELADO") continue;
      if (situation === "PAGO") totalPago += amount;
      else {
        totalAPagar += remaining;
        if (situation === "VENCIDO") totalVencido += remaining;
        if (situation === "A_VENCER") totalAVencer += remaining;
      }

      const cat = porCategoria.get(r.category) ?? { category: r.category, total: 0, remaining: 0, count: 0 };
      cat.total += amount;
      cat.remaining += remaining;
      cat.count += 1;
      porCategoria.set(r.category, cat);

      const supKey = r.supplier?.id ?? "__sem__";
      const sup = porFornecedor.get(supKey) ?? { supplierId: r.supplier?.id ?? null, supplier: r.supplier?.name ?? "Sem fornecedor", total: 0, remaining: 0, count: 0 };
      sup.total += amount;
      sup.remaining += remaining;
      sup.count += 1;
      porFornecedor.set(supKey, sup);

      const tipo = porTipo.get(r.docType) ?? { docType: r.docType, total: 0, remaining: 0, count: 0 };
      tipo.total += amount;
      tipo.remaining += remaining;
      tipo.count += 1;
      porTipo.set(r.docType, tipo);

      movimentacoes.push({ id: r.id, category: r.category, amount, date: refDate, kind: situation === "PAGO" ? "PAGO" : "EM_ABERTO" });
    }

    const top = <T extends { total: number }>(m: Map<string, T>, n = 10) =>
      [...m.values()].map((v) => ({ ...v, total: round2(v.total) })).sort((a, b) => b.total - a.total).slice(0, n);

    return ok(res, {
      periodo: { from: from ?? null, to: to ?? null },
      alertDays,
      totais: {
        aPagar: round2(totalAPagar),
        pago: round2(totalPago),
        vencido: round2(totalVencido),
        aVencer: round2(totalAVencer),
      },
      porCategoria: top(porCategoria),
      porFornecedor: top(porFornecedor),
      porTipo: [...porTipo.values()].map((v) => ({ ...v, total: round2(v.total), remaining: round2(v.remaining) })),
      movimentacoes: movimentacoes
        .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
        .slice(0, 50),
    });
  })
);

// GET /api/finance/documents/payments/:paymentId/receipt — comprovante
router.get(
  "/payments/:paymentId/receipt",
  canRead,
  asyncHandler(async (req, res) => {
    const p = await prisma.financePayment.findFirst({
      where: { id: req.params.paymentId, transaction: { organizationId: req.user!.organizationId } },
      select: { receiptKey: true, receiptName: true, receiptMime: true },
    });
    if (!p?.receiptKey) throw new NotFoundError("Comprovante não encontrado");
    const name = p.receiptName ?? "comprovante";
    const signed = await storage.getSignedUrl(p.receiptKey, name);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(p.receiptKey);
    res.setHeader("Content-Type", p.receiptMime ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(name)}"`);
    return pipeToResponse(stream, res);
  })
);

// GET /api/finance/documents/attachments/:attachmentId — arquivo do documento
router.get(
  "/attachments/:attachmentId",
  canRead,
  asyncHandler(async (req, res) => {
    const a = await prisma.financeAttachment.findFirst({
      where: { id: req.params.attachmentId, transaction: { organizationId: req.user!.organizationId } },
    });
    if (!a) throw new NotFoundError("Anexo não encontrado");
    const signed = await storage.getSignedUrl(a.storageKey, a.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(a.storageKey);
    res.setHeader("Content-Type", a.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

// DELETE /api/finance/documents/attachments/:attachmentId
router.delete(
  "/attachments/:attachmentId",
  canManage,
  asyncHandler(async (req, res) => {
    const a = await prisma.financeAttachment.findFirst({
      where: { id: req.params.attachmentId, transaction: { organizationId: req.user!.organizationId } },
      select: { id: true, storageKey: true, transactionId: true, fileName: true },
    });
    if (!a) throw new NotFoundError("Anexo não encontrado");
    await prisma.financeAttachment.delete({ where: { id: a.id } });
    await storage.remove(a.storageKey).catch(() => undefined);
    await audit(req.user!.id, "FINANCE_ATTACHMENT_DELETED", a.transactionId, { fileName: a.fileName });
    return ok(res, { id: a.id }, "Anexo removido");
  })
);


// POST /api/finance/documents/payments/:paymentId/receipt -> emite ou reemite o recibo
router.post(
  "/payments/:paymentId/receipt",
  canPay,
  asyncHandler(async (req, res) => {
    const r = await issueReceipt(req.params.paymentId, req.user!.organizationId, req.user!.id);
    return ok(res, r, r.version > 1 ? `Recibo ${r.number} reemitido (versão ${r.version})` : `Recibo ${r.number} emitido`);
  })
);

// GET /api/finance/documents/client-proofs -> comprovantes enviados pelos clientes, a conferir
router.get(
  "/client-proofs",
  canRead,
  asyncHandler(async (req, res) => {
    const rows = await prisma.financeAttachment.findMany({
      where: { uploadedByClientAccountId: { not: null }, reviewedAt: null, transaction: { organizationId: req.user!.organizationId } },
      orderBy: { createdAt: "asc" },
      include: {
        transaction: {
          select: { id: true, category: true, amount: true, paidAmount: true, dueDate: true, client: { select: { id: true, name: true } }, project: { select: { code: true } } },
        },
      },
    });
    return ok(res, rows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      createdAt: a.createdAt,
      transaction: { ...a.transaction, amount: money(a.transaction.amount), paidAmount: money(a.transaction.paidAmount) },
    })));
  })
);

// POST /api/finance/documents/client-proofs/:attachmentId/review -> marca como conferido
router.post(
  "/client-proofs/:attachmentId/review",
  canPay,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: clean(1000).optional().nullable() }).parse(req.body ?? {});
    const a = await prisma.financeAttachment.findFirst({
      where: { id: req.params.attachmentId, uploadedByClientAccountId: { not: null }, transaction: { organizationId: req.user!.organizationId } },
      select: { id: true, transactionId: true, reviewedAt: true },
    });
    if (!a) throw new NotFoundError("Comprovante não encontrado");
    if (a.reviewedAt) throw new ValidationError("Este comprovante já foi conferido");
    await prisma.financeAttachment.update({ where: { id: a.id }, data: { reviewedAt: new Date(), reviewNote: txt(note) } });
    await audit(req.user!.id, "CLIENT_PROOF_REVIEWED", a.transactionId, { attachmentId: a.id });
    // conferir não é dar baixa: o pagamento continua sendo registrado à parte
    return ok(res, { id: a.id }, "Comprovante conferido. Registre o pagamento para emitir o recibo.");
  })
);

// ===========================================================================
// CRUD do documento
// ===========================================================================

// POST /api/finance/documents
router.post(
  "/",
  canManage,
  asyncHandler(async (req, res) => {
    const input = docInput.parse(req.body);
    const organizationId = req.user!.organizationId;
    await validateLinks(input, organizationId);

    const doc = await prisma.financeTransaction.create({
      data: {
        organizationId,
        type: input.type,
        docType: input.docType,
        docNumber: txt(input.docNumber),
        category: txtReq(input.category),
        amount: dec(input.amount),
        paidAmount: dec(0),
        status: FinanceStatus.PENDENTE,
        issueDate: input.issueDate ?? null,
        date: input.date ?? input.issueDate ?? new Date(),
        dueDate: input.dueDate ?? null,
        method: txt(input.method),
        description: txt(input.description),
        notes: txt(input.notes),
        purchaseRef: txt(input.purchaseRef),
        alertDays: input.alertDays ?? null,
        supplierId: input.supplierId ?? null,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        responsibleId: input.responsibleId ?? null,
        relatedId: input.relatedId ?? null,
        createdById: req.user!.id,
      },
      include,
    });

    await audit(req.user!.id, "FINANCE_DOC_CREATED", doc.id, { docType: doc.docType, amount: money(doc.amount) });
    if (doc.responsibleId && doc.responsibleId !== req.user!.id) {
      await notifyUser(doc.responsibleId, "Documento financeiro sob sua responsabilidade", `${doc.docType} ${doc.docNumber ?? ""} · ${doc.category}`.trim());
    }
    return ok(res, serialize(doc, await orgAlertDays()), "Documento cadastrado");
  })
);

// GET /api/finance/documents/:id — detalhe com pagamentos e anexos
router.get(
  "/:id",
  canRead,
  asyncHandler(async (req, res) => {
    const doc = await loadDoc(req.params.id, req.user!.organizationId);
    const [payments, attachments, relatedBy] = await Promise.all([
      prisma.financePayment.findMany({
        where: { transactionId: doc.id },
        orderBy: { paidAt: "desc" },
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      prisma.financeAttachment.findMany({
        where: { transactionId: doc.id },
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
      prisma.financeTransaction.findMany({
        where: { relatedId: doc.id },
        select: { id: true, docType: true, docNumber: true, amount: true, dueDate: true, status: true },
      }),
    ]);

    return ok(res, {
      ...serialize(doc, await orgAlertDays()),
      payments: payments.map((p) => ({
        id: p.id,
        amount: money(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        note: p.note,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        receipt: p.receiptKey ? { name: p.receiptName, mimeType: p.receiptMime, size: p.receiptSize } : null,
        // recibo emitido pelo sistema (diferente do comprovante enviado)
        issuedReceiptId: p.receiptDocumentId,
      })),
      attachments: attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.size,
        uploadedBy: a.uploadedBy,
        createdAt: a.createdAt,
      })),
      relatedBy: relatedBy.map((r) => ({ ...r, amount: money(r.amount) })),
    });
  })
);

// PATCH /api/finance/documents/:id
router.patch(
  "/:id",
  canManage,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const current = await loadDoc(req.params.id, organizationId);
    if (current.status === FinanceStatus.CANCELADO) throw new ValidationError("Documento cancelado não pode ser editado");

    const input = docInput.partial().parse(req.body);
    await validateLinks(input, organizationId, current.id);

    // o valor não pode ficar abaixo do que já foi pago, senão o saldo vira negativo
    if (input.amount !== undefined) {
      const paid = money(current.paidAmount);
      if (round2(input.amount) < paid - 0.01) {
        throw new ValidationError(
          `O valor não pode ser menor que os ${paid.toFixed(2)} já pagos. Estorne um pagamento antes de reduzir o documento.`,
          { amount: input.amount, paidAmount: paid }
        );
      }
    }

    const doc = await prisma.$transaction(async (tx) => {
      await tx.financeTransaction.update({
        where: { id: current.id },
        data: {
          type: input.type,
          docType: input.docType,
          docNumber: input.docNumber === undefined ? undefined : txt(input.docNumber),
          category: input.category === undefined ? undefined : txtReq(input.category),
          amount: input.amount === undefined ? undefined : dec(input.amount),
          issueDate: input.issueDate === undefined ? undefined : input.issueDate,
          date: input.date,
          dueDate: input.dueDate === undefined ? undefined : input.dueDate,
          method: input.method === undefined ? undefined : txt(input.method),
          description: input.description === undefined ? undefined : txt(input.description),
          notes: input.notes === undefined ? undefined : txt(input.notes),
          purchaseRef: input.purchaseRef === undefined ? undefined : txt(input.purchaseRef),
          alertDays: input.alertDays === undefined ? undefined : input.alertDays,
          supplierId: input.supplierId === undefined ? undefined : input.supplierId,
          clientId: input.clientId === undefined ? undefined : input.clientId,
          projectId: input.projectId === undefined ? undefined : input.projectId,
          responsibleId: input.responsibleId === undefined ? undefined : input.responsibleId,
          relatedId: input.relatedId === undefined ? undefined : input.relatedId,
        },
      });
      // mudar o valor pode quitar ou reabrir o documento
      if (input.amount !== undefined) await recalc(tx, current.id);
      return tx.financeTransaction.findUniqueOrThrow({ where: { id: current.id }, include });
    });

    await audit(req.user!.id, "FINANCE_DOC_UPDATED", doc.id, { fields: Object.keys(input) });
    return ok(res, serialize(doc, await orgAlertDays()), "Documento atualizado");
  })
);

// POST /api/finance/documents/:id/cancel
router.post(
  "/:id/cancel",
  canManage,
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: clean(500).optional() }).parse(req.body ?? {});
    const current = await loadDoc(req.params.id, req.user!.organizationId);
    if (current.status === FinanceStatus.CANCELADO) throw new ValidationError("Documento já está cancelado");
    if (current._count.payments > 0) {
      throw new ValidationError("Estorne os pagamentos antes de cancelar este documento", { payments: current._count.payments });
    }

    const doc = await prisma.financeTransaction.update({
      where: { id: current.id },
      data: {
        status: FinanceStatus.CANCELADO,
        paidAt: null,
        notes: reason ? [current.notes, `Cancelado: ${txtReq(reason)}`].filter(Boolean).join("\n") : current.notes,
      },
      include,
    });
    await audit(req.user!.id, "FINANCE_DOC_CANCELLED", doc.id, { reason: reason ?? null });
    return ok(res, serialize(doc, await orgAlertDays()), "Documento cancelado");
  })
);

// POST /api/finance/documents/:id/reopen — desfaz o cancelamento
router.post(
  "/:id/reopen",
  canManage,
  asyncHandler(async (req, res) => {
    const current = await loadDoc(req.params.id, req.user!.organizationId);
    if (current.status !== FinanceStatus.CANCELADO) throw new ValidationError("Só um documento cancelado pode ser reaberto");

    const doc = await prisma.$transaction(async (tx) => {
      await tx.financeTransaction.update({ where: { id: current.id }, data: { status: FinanceStatus.PENDENTE } });
      await recalc(tx, current.id);
      return tx.financeTransaction.findUniqueOrThrow({ where: { id: current.id }, include });
    });
    await audit(req.user!.id, "FINANCE_DOC_REOPENED", doc.id);
    return ok(res, serialize(doc, await orgAlertDays()), "Documento reaberto");
  })
);

// DELETE /api/finance/documents/:id
router.delete(
  "/:id",
  canManage,
  asyncHandler(async (req, res) => {
    const current = await loadDoc(req.params.id, req.user!.organizationId);
    if (current._count.payments > 0) {
      throw new ValidationError("Este documento tem pagamentos registrados. Cancele em vez de excluir, para não perder o histórico.");
    }
    const files = await prisma.financeAttachment.findMany({ where: { transactionId: current.id }, select: { storageKey: true } });
    await prisma.financeTransaction.delete({ where: { id: current.id } });
    for (const f of files) await storage.remove(f.storageKey).catch(() => undefined);
    await audit(req.user!.id, "FINANCE_DOC_DELETED", current.id, { docNumber: current.docNumber, amount: money(current.amount) });
    return ok(res, { id: current.id }, "Documento removido");
  })
);

// ===========================================================================
// Pagamentos
// ===========================================================================

// POST /api/finance/documents/:id/payments — total ou parcial, com comprovante
router.post(
  "/:id/payments",
  canPay,
  uploadDocument.single("receipt"),
  asyncHandler(async (req, res) => {
    const current = await loadDoc(req.params.id, req.user!.organizationId);
    assertPayable(current.status);

    const input = z
      .object({
        amount: z.coerce.number().positive().max(1_000_000_000),
        paidAt: z.coerce.date().optional(),
        method: clean(60).optional().nullable(),
        note: clean(2000).optional().nullable(),
      })
      .parse(req.body ?? {});

    assertPaymentAmount(input.amount, money(current.amount), money(current.paidAmount));

    let receipt: { receiptKey: string; receiptName: string; receiptMime: string; receiptSize: number } | null = null;
    if (req.file) {
      const key = buildStorageKey(`finance/${current.id}`, req.file.originalname);
      await storage.put(key, req.file.buffer, req.file.mimetype);
      receipt = { receiptKey: key, receiptName: req.file.originalname, receiptMime: req.file.mimetype, receiptSize: req.file.size };
    }

    try {
      const { payment, doc } = await prisma.$transaction(async (tx) => {
        const payment = await tx.financePayment.create({
          data: {
            transactionId: current.id,
            amount: dec(input.amount),
            paidAt: input.paidAt ?? new Date(),
            method: txt(input.method) ?? current.method ?? null,
            note: txt(input.note),
            createdById: req.user!.id,
            ...(receipt ?? {}),
          },
        });
        // recalcula da soma: dois caixas pagando ao mesmo tempo não desalinham o saldo
        await recalc(tx, current.id);
        const doc = await tx.financeTransaction.findUniqueOrThrow({ where: { id: current.id }, include });
        return { payment, doc };
      });

      const alertDays = await orgAlertDays();
      const view = serialize(doc, alertDays);
      await audit(req.user!.id, "FINANCE_PAYMENT_REGISTERED", doc.id, {
        paymentId: payment.id,
        amount: input.amount,
        remaining: view.remaining,
        status: doc.status,
      });
      if (doc.responsibleId && doc.responsibleId !== req.user!.id) {
        await notifyUser(
          doc.responsibleId,
          doc.status === FinanceStatus.PAGO ? "Documento quitado" : "Pagamento parcial registrado",
          `${doc.category} · pago ${input.amount.toFixed(2)}${view.remaining > 0 ? ` · restam ${view.remaining.toFixed(2)}` : ""}`
        );
      }
      // Recibo automático para recebimento de cliente. O pagamento já está
      // gravado: falha no PDF não pode subir para o catch abaixo (que apaga o
      // comprovante) nem desfazer nada — o recibo pode ser reemitido depois.
      let receiptInfo: { documentId: string; number: string } | null = null;
      if (doc.type === "RECEITA" && doc.client) {
        try {
          receiptInfo = await issueReceipt(payment.id, req.user!.organizationId, req.user!.id);
        } catch (err) {
          console.error("[recibo] falha ao emitir:", err instanceof Error ? err.message : err);
        }
      }
      return ok(
        res,
        { payment: { id: payment.id, amount: money(payment.amount), paidAt: payment.paidAt }, document: view, receipt: receiptInfo },
        view.remaining > 0 ? `Pagamento registrado. Saldo em aberto: ${view.remaining.toFixed(2)}` : "Documento quitado"
      );
    } catch (e) {
      // o arquivo já subiu: sem isso ele ficaria órfão no storage
      if (receipt) await storage.remove(receipt.receiptKey).catch(() => undefined);
      throw e;
    }
  })
);

// DELETE /api/finance/documents/:id/payments/:paymentId — estorno
router.delete(
  "/:id/payments/:paymentId",
  canPay,
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const payment = await prisma.financePayment.findFirst({
      where: { id: req.params.paymentId, transactionId: req.params.id, transaction: { organizationId } },
      select: { id: true, amount: true, receiptKey: true },
    });
    if (!payment) throw new NotFoundError("Pagamento não encontrado");

    const doc = await prisma.$transaction(async (tx) => {
      await tx.financePayment.delete({ where: { id: payment.id } });
      await recalc(tx, req.params.id);
      return tx.financeTransaction.findUniqueOrThrow({ where: { id: req.params.id }, include });
    });
    if (payment.receiptKey) await storage.remove(payment.receiptKey).catch(() => undefined);

    await audit(req.user!.id, "FINANCE_PAYMENT_REVERSED", doc.id, { paymentId: payment.id, amount: money(payment.amount) });
    return ok(res, serialize(doc, await orgAlertDays()), "Pagamento estornado");
  })
);

// ===========================================================================
// Anexos do documento
// ===========================================================================

// POST /api/finance/documents/:id/attachments
router.post(
  "/:id/attachments",
  canManage,
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const current = await loadDoc(req.params.id, req.user!.organizationId);
    if (!req.file) throw new ValidationError("Anexe um arquivo");
    const { kind } = z.object({ kind: z.nativeEnum(FinanceAttachmentKind).default(FinanceAttachmentKind.DOCUMENTO) }).parse(req.body ?? {});

    const key = buildStorageKey(`finance/${current.id}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    try {
      const a = await prisma.financeAttachment.create({
        data: {
          transactionId: current.id,
          kind,
          storageKey: key,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedById: req.user!.id,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      await audit(req.user!.id, "FINANCE_ATTACHMENT_ADDED", current.id, { fileName: a.fileName, kind });
      return ok(
        res,
        { id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, size: a.size, uploadedBy: a.uploadedBy, createdAt: a.createdAt },
        "Arquivo anexado"
      );
    } catch (e) {
      await storage.remove(key).catch(() => undefined);
      throw e;
    }
  })
);

export default router;
