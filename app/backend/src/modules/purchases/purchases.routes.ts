/**
 * §30 — Compras.
 *
 * Solicitação (purchases.request) → aprovação (purchases.approve) → cotações e
 * comparação → pedido → envio (gera conta a pagar) → recebimento (dá entrada
 * no estoque). Tudo que cota, emite e recebe exige purchases.manage.
 *
 * Quem só pode solicitar enxerga as próprias solicitações; ver todas exige
 * approve ou manage — conferido aqui, não só na tela.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, PurchaseOrderStatus, PurchaseRequestStatus, PurchaseUrgency, Unit } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { enumQuery } from "../../utils/query";
import { notifyUser, notifyUsersWithPermission } from "../../lib/notify";
import { csvFileName, toCsv, type CsvColumn } from "../../utils/csv";
import {
  ORDER_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  aceitaCotacao,
  compararCotacoes,
  nextOrderStatus,
  nextRequestStatus,
  quantidadeReposicao,
  round2,
  totalPedido,
} from "./purchases.rules";
import { ensurePayable, nextNumber, receiveOrder, withNumberRetry } from "./purchases.service";

const router = Router();
router.use(authenticate);

const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const has = (req: Request, code: string) => req.user!.permissions.includes(code);
const seesAll = (req: Request) => has(req, "purchases.manage") || has(req, "purchases.approve");

async function audit(userId: string, action: string, entity: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity, entityId, details } });
}

// ============================================================
// Serialização
// ============================================================

const requestInclude = {
  requester: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  requisition: { select: { id: true, number: true } },
  items: { include: { product: { select: { id: true, code: true, name: true, unit: true, stock: true } } } },
  quotes: {
    include: { supplier: { select: { id: true, name: true } }, items: true, createdBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  orders: { select: { id: true, number: true, status: true, supplier: { select: { id: true, name: true } } } },
} satisfies Prisma.PurchaseRequestInclude;

type RequestRow = Prisma.PurchaseRequestGetPayload<{ include: typeof requestInclude }>;

function serializeRequest(r: RequestRow) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    statusLabel: REQUEST_STATUS_LABEL[r.status],
    urgency: r.urgency,
    reason: r.reason,
    notes: r.notes,
    neededBy: r.neededBy,
    requester: r.requester,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    project: r.project,
    requisition: r.requisition,
    createdAt: r.createdAt,
    items: r.items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      product: i.product,
    })),
    quotes: r.quotes.map((q) => ({
      id: q.id,
      supplier: q.supplier,
      validUntil: q.validUntil,
      deliveryDays: q.deliveryDays,
      paymentTerms: q.paymentTerms,
      freight: money(q.freight),
      notes: q.notes,
      selected: q.selected,
      createdBy: q.createdBy,
      createdAt: q.createdAt,
      items: q.items.map((qi) => ({ requestItemId: qi.requestItemId, unitPrice: money(qi.unitPrice) })),
    })),
    orders: r.orders.map((o) => ({ ...o, statusLabel: ORDER_STATUS_LABEL[o.status] })),
  };
}

const orderInclude = {
  supplier: { select: { id: true, name: true, phone: true, email: true } },
  request: { select: { id: true, number: true } },
  project: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  financeTransaction: { select: { id: true, status: true, amount: true, dueDate: true } },
  items: { include: { product: { select: { id: true, code: true, name: true, unit: true } } }, orderBy: { description: "asc" as const } },
  receipts: {
    include: {
      receivedBy: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      items: { select: { orderItemId: true, quantity: true, stockMovementId: true } },
    },
    orderBy: { receivedAt: "desc" as const },
  },
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

function serializeOrder(o: OrderRow, now = new Date()) {
  const items = o.items.map((i) => ({
    id: i.id,
    description: i.description,
    quantity: i.quantity,
    unitPrice: money(i.unitPrice),
    receivedQty: i.receivedQty,
    pendingQty: Math.max(0, i.quantity - i.receivedQty),
    total: round2(i.quantity * money(i.unitPrice)),
    product: i.product,
  }));
  const aberto = o.status === "SENT" || o.status === "PARTIALLY_RECEIVED";
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: ORDER_STATUS_LABEL[o.status],
    supplier: o.supplier,
    request: o.request,
    project: o.project,
    expectedDeliveryAt: o.expectedDeliveryAt,
    late: aberto && !!o.expectedDeliveryAt && o.expectedDeliveryAt < now,
    paymentTerms: o.paymentTerms,
    freight: money(o.freight),
    notes: o.notes,
    sentAt: o.sentAt,
    receivedAt: o.receivedAt,
    cancelledAt: o.cancelledAt,
    createdBy: o.createdBy,
    createdAt: o.createdAt,
    total: totalPedido(items, money(o.freight)),
    payable: o.financeTransaction ? { ...o.financeTransaction, amount: money(o.financeTransaction.amount) } : null,
    items,
    receipts: o.receipts.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt,
      invoiceNumber: r.invoiceNumber,
      notes: r.notes,
      receivedBy: r.receivedBy,
      warehouse: r.warehouse,
      items: r.items,
    })),
  };
}

// ============================================================
// Resumo
// ============================================================

// GET /api/purchases/summary
router.get(
  "/summary",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const org = req.user!.organizationId;
    const mine = seesAll(req) ? {} : { requesterId: req.user!.id };
    const now = new Date();
    const [awaitingApproval, approved, openOrders, lateOrders, lowStock] = await Promise.all([
      prisma.purchaseRequest.count({ where: { organizationId: org, status: "REQUESTED", ...mine } }),
      prisma.purchaseRequest.count({ where: { organizationId: org, status: "APPROVED", ...mine } }),
      prisma.purchaseOrder.findMany({
        where: { organizationId: org, status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
        select: { freight: true, items: { select: { quantity: true, unitPrice: true } } },
      }),
      prisma.purchaseOrder.count({
        where: { organizationId: org, status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedDeliveryAt: { lt: now } },
      }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Product" WHERE "status" = 'ACTIVE' AND "minStock" > 0 AND "stock" <= "minStock"`,
    ]);
    return ok(res, {
      awaitingApproval,
      approved,
      openOrders: openOrders.length,
      openOrdersValue: round2(
        openOrders.reduce((s, o) => s + totalPedido(o.items.map((i) => ({ quantity: i.quantity, unitPrice: money(i.unitPrice) })), money(o.freight)), 0)
      ),
      lateOrders,
      lowStockProducts: Number(lowStock[0]?.n ?? 0),
    });
  })
);

// ============================================================
// Solicitações
// ============================================================

const requestItemSchema = z
  .object({
    productId: z.string().min(1).optional().nullable(),
    description: z.string().trim().max(300).optional().nullable(),
    quantity: z.coerce.number().int().positive("Quantidade deve ser maior que zero").max(1_000_000),
    unit: z.nativeEnum(Unit).optional(),
  })
  .refine((i) => i.productId || (i.description && i.description.length >= 2), "Escolha um produto ou descreva o item");

const requestSchema = z.object({
  urgency: z.nativeEnum(PurchaseUrgency).default("NORMAL"),
  reason: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  neededBy: z.coerce.date().optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
  requisitionId: z.string().min(1).optional().nullable(),
  items: z.array(requestItemSchema).min(1, "Adicione ao menos um item").max(200),
});

async function createRequest(req: Request, input: z.infer<typeof requestSchema>) {
  const org = req.user!.organizationId;
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: org }, select: { id: true } });
    if (!p) throw new BadRequestError("Projeto inválido");
  }
  if (input.requisitionId) {
    const r = await prisma.requisition.findUnique({ where: { id: input.requisitionId }, select: { id: true } });
    if (!r) throw new BadRequestError("Requisição inválida");
  }
  const productIds = [...new Set(input.items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true } });
  if (products.length !== productIds.length) throw new BadRequestError("Produto inválido na lista");
  const byId = new Map(products.map((p) => [p.id, p]));

  const created = await withNumberRetry(async () =>
    prisma.purchaseRequest.create({
      data: {
        organizationId: org,
        number: await nextNumber("request"),
        urgency: input.urgency,
        reason: input.reason || null,
        notes: input.notes || null,
        neededBy: input.neededBy ?? null,
        projectId: input.projectId || null,
        requisitionId: input.requisitionId || null,
        requesterId: req.user!.id,
        items: {
          create: input.items.map((i) => {
            const p = i.productId ? byId.get(i.productId) : undefined;
            return {
              productId: p?.id ?? null,
              description: i.description?.trim() || p!.name,
              quantity: i.quantity,
              unit: i.unit ?? p?.unit ?? "UNIT",
            };
          }),
        },
      },
      include: requestInclude,
    })
  );
  await audit(req.user!.id, "PURCHASE_REQUESTED", "PurchaseRequest", created.id, { number: created.number, items: created.items.length });
  await notifyUsersWithPermission({
    organizationId: org,
    permission: "purchases.approve",
    title: "Solicitação de compra aguardando aprovação",
    message: `${created.number} — ${req.user!.name}: ${created.items.length} item(ns)${input.urgency === "URGENT" ? " (URGENTE)" : ""}.`,
    excludeUserId: req.user!.id,
  });
  return created;
}

// GET /api/purchases/requests?status=&search=
router.get(
  "/requests",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? enumQuery(String(req.query.status), PurchaseRequestStatus, "status") : undefined;
    const search = String(req.query.search ?? "").trim();
    const rows = await prisma.purchaseRequest.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(status ? { status } : {}),
        ...(seesAll(req) ? {} : { requesterId: req.user!.id }),
        ...(search
          ? {
              OR: [
                { number: { contains: search, mode: "insensitive" } },
                { reason: { contains: search, mode: "insensitive" } },
                { items: { some: { description: { contains: search, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok(res, rows.map(serializeRequest));
  })
);

// GET /api/purchases/requests/:id
router.get(
  "/requests/:id",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const r = await prisma.purchaseRequest.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId, ...(seesAll(req) ? {} : { requesterId: req.user!.id }) },
      include: requestInclude,
    });
    if (!r) throw new NotFoundError("Solicitação não encontrada");
    return ok(res, serializeRequest(r));
  })
);

// POST /api/purchases/requests
router.post(
  "/requests",
  requirePermission("purchases.request"),
  asyncHandler(async (req, res) => {
    const created = await createRequest(req, requestSchema.parse(req.body));
    return ok(res, serializeRequest(created), "Solicitação de compra aberta");
  })
);

// GET /api/purchases/replenishment — produtos abaixo do mínimo, com a quantidade
// sugerida já descontando o que está a caminho em pedidos abertos (§63:
// "material faltando → permitir gerar solicitação de compra").
router.get(
  "/replenishment",
  requirePermission("purchases.request"),
  asyncHandler(async (req, res) => {
    const low = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Product" WHERE "status" = 'ACTIVE' AND "minStock" > 0 AND "stock" <= "minStock"`;
    const products = await prisma.product.findMany({
      where: { id: { in: low.map((l) => l.id) } },
      select: { id: true, code: true, name: true, unit: true, stock: true, minStock: true, maxStock: true, supplier: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
    const aCaminho = await prisma.purchaseOrderItem.findMany({
      where: {
        productId: { in: products.map((p) => p.id) },
        order: { organizationId: req.user!.organizationId, status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
      },
      select: { productId: true, quantity: true, receivedQty: true },
    });
    const pendente = new Map<string, number>();
    for (const i of aCaminho) pendente.set(i.productId!, (pendente.get(i.productId!) ?? 0) + Math.max(0, i.quantity - i.receivedQty));
    return ok(
      res,
      products.map((p) => ({
        ...p,
        onOrder: pendente.get(p.id) ?? 0,
        suggestedQty: quantidadeReposicao(p, pendente.get(p.id) ?? 0),
      }))
    );
  })
);

// POST /api/purchases/requests/:id/decision { action: APPROVE|REJECT, note }
router.post(
  "/requests/:id/decision",
  requirePermission("purchases.approve"),
  asyncHandler(async (req, res) => {
    const { action, note } = z
      .object({ action: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(2000).optional().nullable() })
      .parse(req.body);
    const r = await prisma.purchaseRequest.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!r) throw new NotFoundError("Solicitação não encontrada");
    const t = nextRequestStatus(r.status, action);
    if (!t.ok) throw new BadRequestError(t.motivo);
    if (action === "REJECT" && !note) throw new BadRequestError("Informe o motivo da recusa");
    const updated = await prisma.purchaseRequest.update({
      where: { id: r.id },
      data: { status: t.status, decidedById: req.user!.id, decidedAt: new Date(), decisionNote: note || null },
      include: requestInclude,
    });
    await audit(req.user!.id, action === "APPROVE" ? "PURCHASE_APPROVED" : "PURCHASE_REJECTED", "PurchaseRequest", r.id, { number: r.number, note });
    await notifyUser(
      r.requesterId,
      action === "APPROVE" ? "Solicitação de compra aprovada" : "Solicitação de compra recusada",
      `${r.number}${note ? ` — ${note}` : ""}`
    );
    if (action === "APPROVE") {
      await notifyUsersWithPermission({
        organizationId: r.organizationId,
        permission: "purchases.manage",
        title: "Compra aprovada para cotação",
        message: `${r.number} foi aprovada e aguarda cotação.`,
        excludeUserId: req.user!.id,
      });
    }
    return ok(res, serializeRequest(updated), action === "APPROVE" ? "Solicitação aprovada" : "Solicitação recusada");
  })
);

// POST /api/purchases/requests/:id/cancel — quem abriu ou quem gerencia
router.post(
  "/requests/:id/cancel",
  requireAnyPermission(["purchases.request", "purchases.manage"]),
  asyncHandler(async (req, res) => {
    const r = await prisma.purchaseRequest.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!r) throw new NotFoundError("Solicitação não encontrada");
    if (r.requesterId !== req.user!.id && !has(req, "purchases.manage")) {
      throw new BadRequestError("Só quem abriu a solicitação ou o setor de compras pode cancelar");
    }
    const t = nextRequestStatus(r.status, "CANCEL");
    if (!t.ok) throw new BadRequestError(t.motivo);
    const updated = await prisma.purchaseRequest.update({ where: { id: r.id }, data: { status: t.status }, include: requestInclude });
    await audit(req.user!.id, "PURCHASE_REQUEST_CANCELLED", "PurchaseRequest", r.id, { number: r.number });
    return ok(res, serializeRequest(updated), "Solicitação cancelada");
  })
);

// ============================================================
// Cotações
// ============================================================

const quoteSchema = z.object({
  supplierId: z.string().min(1, "Escolha o fornecedor"),
  validUntil: z.coerce.date().optional().nullable(),
  deliveryDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  paymentTerms: z.string().trim().max(200).optional().nullable(),
  freight: z.coerce.number().min(0).max(10_000_000).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  // item sem preço = fornecedor não cotou aquele item
  prices: z
    .array(z.object({ requestItemId: z.string().min(1), unitPrice: z.coerce.number().min(0).max(10_000_000) }))
    .min(1, "Informe o preço de ao menos um item"),
});

// POST /api/purchases/requests/:id/quotes — cria ou substitui a cotação do fornecedor
router.post(
  "/requests/:id/quotes",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const input = quoteSchema.parse(req.body);
    const r = await prisma.purchaseRequest.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { items: { select: { id: true } } },
    });
    if (!r) throw new NotFoundError("Solicitação não encontrada");
    if (!aceitaCotacao(r.status)) throw new BadRequestError(`Solicitação "${REQUEST_STATUS_LABEL[r.status]}" não recebe cotação`);
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, status: true } });
    if (!supplier) throw new BadRequestError("Fornecedor inválido");
    if (supplier.status !== "ACTIVE") throw new BadRequestError("Fornecedor inativo");
    const validos = new Set(r.items.map((i) => i.id));
    if (input.prices.some((p) => !validos.has(p.requestItemId))) throw new BadRequestError("Preço para item que não é desta solicitação");

    const existing = await prisma.purchaseQuote.findUnique({
      where: { requestId_supplierId: { requestId: r.id, supplierId: input.supplierId } },
      select: { id: true, order: { select: { id: true } } },
    });
    if (existing?.order) throw new BadRequestError("A cotação deste fornecedor já virou pedido e não pode ser alterada");

    const data = {
      validUntil: input.validUntil ?? null,
      deliveryDays: input.deliveryDays ?? null,
      paymentTerms: input.paymentTerms || null,
      freight: input.freight,
      notes: input.notes || null,
    };
    const quote = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.purchaseQuoteItem.deleteMany({ where: { quoteId: existing.id } });
        return tx.purchaseQuote.update({
          where: { id: existing.id },
          data: { ...data, items: { create: input.prices.map((p) => ({ requestItemId: p.requestItemId, unitPrice: p.unitPrice })) } },
        });
      }
      return tx.purchaseQuote.create({
        data: {
          ...data,
          requestId: r.id,
          supplierId: input.supplierId,
          createdById: req.user!.id,
          items: { create: input.prices.map((p) => ({ requestItemId: p.requestItemId, unitPrice: p.unitPrice })) },
        },
      });
    });
    await audit(req.user!.id, existing ? "PURCHASE_QUOTE_UPDATED" : "PURCHASE_QUOTE_CREATED", "PurchaseQuote", quote.id, {
      request: r.number,
      supplierId: input.supplierId,
    });
    const full = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: r.id }, include: requestInclude });
    return ok(res, serializeRequest(full), existing ? "Cotação atualizada" : "Cotação registrada");
  })
);

// DELETE /api/purchases/quotes/:id
router.delete(
  "/quotes/:id",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const q = await prisma.purchaseQuote.findFirst({
      where: { id: req.params.id, request: { organizationId: req.user!.organizationId } },
      select: { id: true, order: { select: { id: true } } },
    });
    if (!q) throw new NotFoundError("Cotação não encontrada");
    if (q.order) throw new BadRequestError("Cotação que já virou pedido não pode ser excluída");
    await prisma.purchaseQuote.delete({ where: { id: q.id } });
    await audit(req.user!.id, "PURCHASE_QUOTE_DELETED", "PurchaseQuote", q.id);
    return ok(res, { deleted: true }, "Cotação excluída");
  })
);

// GET /api/purchases/requests/:id/comparison
router.get(
  "/requests/:id/comparison",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const r = await prisma.purchaseRequest.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId, ...(seesAll(req) ? {} : { requesterId: req.user!.id }) },
      include: { items: true, quotes: { include: { supplier: { select: { name: true } }, items: true } } },
    });
    if (!r) throw new NotFoundError("Solicitação não encontrada");
    return ok(
      res,
      compararCotacoes(
        r.items,
        r.quotes.map((q) => ({
          id: q.id,
          supplierName: q.supplier.name,
          freight: money(q.freight),
          deliveryDays: q.deliveryDays,
          prices: q.items.map((i) => ({ requestItemId: i.requestItemId, unitPrice: money(i.unitPrice) })),
        }))
      )
    );
  })
);

// ============================================================
// Pedidos
// ============================================================

const DAY_MS = 86_400_000;

// POST /api/purchases/quotes/:id/order — transforma a cotação escolhida em pedido
router.post(
  "/quotes/:id/order",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const { expectedDeliveryAt, notes } = z
      .object({ expectedDeliveryAt: z.coerce.date().optional().nullable(), notes: z.string().trim().max(2000).optional().nullable() })
      .parse(req.body ?? {});
    const q = await prisma.purchaseQuote.findFirst({
      where: { id: req.params.id, request: { organizationId: req.user!.organizationId } },
      include: { request: { include: { items: true } }, items: true, order: { select: { id: true } } },
    });
    if (!q) throw new NotFoundError("Cotação não encontrada");
    if (q.order) throw new BadRequestError("Esta cotação já virou pedido");
    const t = nextRequestStatus(q.request.status, "ORDER");
    if (!t.ok) throw new BadRequestError(t.motivo);
    if (!q.items.length) throw new BadRequestError("Cotação sem itens com preço");

    const reqItems = new Map(q.request.items.map((i) => [i.id, i]));
    const previsao = expectedDeliveryAt ?? (q.deliveryDays != null ? new Date(Date.now() + q.deliveryDays * DAY_MS) : null);

    const order = await withNumberRetry(async () =>
      prisma.$transaction(async (tx) => {
        const o = await tx.purchaseOrder.create({
          data: {
            organizationId: q.request.organizationId,
            number: await nextNumber("order", tx),
            supplierId: q.supplierId,
            requestId: q.requestId,
            quoteId: q.id,
            projectId: q.request.projectId,
            expectedDeliveryAt: previsao,
            paymentTerms: q.paymentTerms,
            freight: q.freight,
            notes: notes || null,
            createdById: req.user!.id,
            items: {
              create: q.items.map((qi) => {
                const ri = reqItems.get(qi.requestItemId)!;
                return {
                  requestItemId: ri.id,
                  productId: ri.productId,
                  description: ri.description,
                  quantity: ri.quantity,
                  unitPrice: qi.unitPrice,
                };
              }),
            },
          },
        });
        await tx.purchaseQuote.update({ where: { id: q.id }, data: { selected: true } });
        await tx.purchaseRequest.update({ where: { id: q.requestId }, data: { status: t.status } });
        return o;
      })
    );
    await audit(req.user!.id, "PURCHASE_ORDER_CREATED", "PurchaseOrder", order.id, { number: order.number, quoteId: q.id, request: q.request.number });
    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    return ok(res, serializeOrder(full), `Pedido ${order.number} criado`);
  })
);

const directOrderSchema = z.object({
  supplierId: z.string().min(1, "Escolha o fornecedor"),
  projectId: z.string().min(1).optional().nullable(),
  expectedDeliveryAt: z.coerce.date().optional().nullable(),
  paymentTerms: z.string().trim().max(200).optional().nullable(),
  freight: z.coerce.number().min(0).max(10_000_000).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z
    .array(
      z
        .object({
          productId: z.string().min(1).optional().nullable(),
          description: z.string().trim().max(300).optional().nullable(),
          quantity: z.coerce.number().int().positive().max(1_000_000),
          unitPrice: z.coerce.number().min(0).max(10_000_000),
        })
        .refine((i) => i.productId || (i.description && i.description.length >= 2), "Escolha um produto ou descreva o item")
    )
    .min(1, "Adicione ao menos um item"),
});

// POST /api/purchases/orders — pedido direto, sem solicitação (reposição de rotina)
router.post(
  "/orders",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const input = directOrderSchema.parse(req.body);
    const org = req.user!.organizationId;
    const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, status: true } });
    if (!supplier || supplier.status !== "ACTIVE") throw new BadRequestError("Fornecedor inválido ou inativo");
    if (input.projectId) {
      const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: org }, select: { id: true } });
      if (!p) throw new BadRequestError("Projeto inválido");
    }
    const productIds = [...new Set(input.items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
    if (products.length !== productIds.length) throw new BadRequestError("Produto inválido na lista");
    const byId = new Map(products.map((p) => [p.id, p]));

    const order = await withNumberRetry(async () =>
      prisma.purchaseOrder.create({
        data: {
          organizationId: org,
          number: await nextNumber("order"),
          supplierId: input.supplierId,
          projectId: input.projectId || null,
          expectedDeliveryAt: input.expectedDeliveryAt ?? null,
          paymentTerms: input.paymentTerms || null,
          freight: input.freight,
          notes: input.notes || null,
          createdById: req.user!.id,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId || null,
              description: i.description?.trim() || byId.get(i.productId!)!.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: orderInclude,
      })
    );
    await audit(req.user!.id, "PURCHASE_ORDER_CREATED", "PurchaseOrder", order.id, { number: order.number, direct: true });
    return ok(res, serializeOrder(order), `Pedido ${order.number} criado`);
  })
);

// GET /api/purchases/orders?status=&supplierId=&late=1
router.get(
  "/orders",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? enumQuery(String(req.query.status), PurchaseOrderStatus, "status") : undefined;
    const late = String(req.query.late ?? "") === "1";
    const rows = await prisma.purchaseOrder.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(status ? { status } : {}),
        ...(req.query.supplierId ? { supplierId: String(req.query.supplierId) } : {}),
        ...(late ? { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedDeliveryAt: { lt: new Date() } } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok(res, rows.map((o) => serializeOrder(o)));
  })
);

// GET /api/purchases/orders/export.csv
router.get(
  "/orders/export.csv",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.purchaseOrder.findMany({
      where: { organizationId: req.user!.organizationId },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    });
    const data = rows.map((o) => serializeOrder(o));
    const cols: CsvColumn<(typeof data)[number]>[] = [
      { header: "Pedido", value: (o) => o.number },
      { header: "Fornecedor", value: (o) => o.supplier.name },
      { header: "Status", value: (o) => o.statusLabel },
      { header: "Solicitação", value: (o) => o.request?.number ?? "" },
      { header: "Projeto", value: (o) => (o.project ? `${o.project.code} ${o.project.name}` : "") },
      { header: "Previsão de entrega", value: (o) => o.expectedDeliveryAt },
      { header: "Enviado em", value: (o) => o.sentAt },
      { header: "Recebido em", value: (o) => o.receivedAt },
      { header: "Frete", value: (o) => o.freight },
      { header: "Total", value: (o) => o.total },
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${csvFileName("pedidos-de-compra")}"`);
    return res.send(toCsv(data, cols));
  })
);

// GET /api/purchases/orders/:id
router.get(
  "/orders/:id",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const o = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, include: orderInclude });
    if (!o) throw new NotFoundError("Pedido não encontrado");
    return ok(res, serializeOrder(o));
  })
);

// PATCH /api/purchases/orders/:id — previsão, condições e observações
router.patch(
  "/orders/:id",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        expectedDeliveryAt: z.coerce.date().optional().nullable(),
        paymentTerms: z.string().trim().max(200).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);
    const o = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!o) throw new NotFoundError("Pedido não encontrado");
    if (o.status === "CANCELLED" || o.status === "RECEIVED") throw new BadRequestError("Pedido encerrado não pode ser alterado");
    const updated = await prisma.purchaseOrder.update({
      where: { id: o.id },
      data: {
        expectedDeliveryAt: input.expectedDeliveryAt === undefined ? undefined : input.expectedDeliveryAt,
        paymentTerms: input.paymentTerms === undefined ? undefined : input.paymentTerms || null,
        notes: input.notes === undefined ? undefined : input.notes || null,
        // nova previsão reabre o aviso de atraso
        lateAlertAt: input.expectedDeliveryAt !== undefined ? null : undefined,
      },
      include: orderInclude,
    });
    await audit(req.user!.id, "PURCHASE_ORDER_UPDATED", "PurchaseOrder", o.id, {
      before: { expectedDeliveryAt: o.expectedDeliveryAt, paymentTerms: o.paymentTerms },
      after: input,
    });
    return ok(res, serializeOrder(updated), "Pedido atualizado");
  })
);

// POST /api/purchases/orders/:id/send — envia ao fornecedor e lança a conta a pagar
router.post(
  "/orders/:id/send",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const o = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!o) throw new NotFoundError("Pedido não encontrado");
    const t = nextOrderStatus(o.status, "SEND", false);
    if (!t.ok) throw new BadRequestError(t.motivo);
    const payableId = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({ where: { id: o.id }, data: { status: t.status, sentAt: new Date() } });
      return ensurePayable(tx, o.id, req.user!.id);
    });
    await audit(req.user!.id, "PURCHASE_ORDER_SENT", "PurchaseOrder", o.id, { number: o.number, financeTransactionId: payableId });
    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
    return ok(res, serializeOrder(full), payableId ? "Pedido enviado e conta a pagar lançada no financeiro" : "Pedido enviado");
  })
);

// POST /api/purchases/orders/:id/cancel
router.post(
  "/orders/:id/cancel",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, "Informe o motivo").max(2000) }).parse(req.body);
    const o = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { items: { select: { receivedQty: true } }, financeTransaction: { select: { id: true, status: true, paidAmount: true } } },
    });
    if (!o) throw new NotFoundError("Pedido não encontrado");
    const t = nextOrderStatus(o.status, "CANCEL", o.items.some((i) => i.receivedQty > 0));
    if (!t.ok) throw new BadRequestError(t.motivo);
    const ft = o.financeTransaction;
    // conta já paga (mesmo parcial) não some sozinha: o financeiro decide o estorno
    if (ft && money(ft.paidAmount) > 0) throw new BadRequestError("A conta a pagar deste pedido já tem pagamento registrado; trate o estorno no financeiro antes");
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: o.id },
        // solta o vínculo único com a cotação para ela poder virar outro pedido
        data: { status: t.status, cancelledAt: new Date(), quoteId: null, notes:[o.notes, `Cancelado: ${reason}`].filter(Boolean).join("\n") },
      });
      if (ft && ft.status !== "CANCELADO") await tx.financeTransaction.update({ where: { id: ft.id }, data: { status: "CANCELADO" } });
      // cotação volta a ficar disponível e a solicitação volta para "aprovada" se não sobrou pedido ativo
      if (o.quoteId) await tx.purchaseQuote.update({ where: { id: o.quoteId }, data: { selected: false } });
      if (o.requestId) {
        const ativos = await tx.purchaseOrder.count({ where: { requestId: o.requestId, status: { not: "CANCELLED" } } });
        if (!ativos) await tx.purchaseRequest.update({ where: { id: o.requestId }, data: { status: "APPROVED" } });
      }
    });
    await audit(req.user!.id, "PURCHASE_ORDER_CANCELLED", "PurchaseOrder", o.id, { number: o.number, reason });
    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
    return ok(res, serializeOrder(full), "Pedido cancelado");
  })
);

// POST /api/purchases/orders/:id/receive
router.post(
  "/orders/:id/receive",
  requirePermission("purchases.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        invoiceNumber: z.string().trim().max(60).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
        warehouseId: z.string().min(1).optional().nullable(),
        receivedAt: z.coerce.date().optional().nullable(),
        items: z.array(z.object({ orderItemId: z.string().min(1), quantity: z.coerce.number().int() })).min(1, "Informe ao menos um item"),
      })
      .parse(req.body);
    const result = await receiveOrder({
      orderId: req.params.id,
      organizationId: req.user!.organizationId,
      actorId: req.user!.id,
      invoiceNumber: input.invoiceNumber,
      notes: input.notes,
      warehouseId: input.warehouseId,
      receivedAt: input.receivedAt,
      lines: input.items,
    });
    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: req.params.id }, include: orderInclude });
    if (full.request) {
      const reqRow = await prisma.purchaseRequest.findUnique({ where: { id: full.request.id }, select: { requesterId: true } });
      await notifyUser(reqRow?.requesterId, "Material de compra recebido", `${full.number}: ${ORDER_STATUS_LABEL[full.status]}.`);
    }
    return ok(
      res,
      serializeOrder(full),
      result.stockEntries ? `Recebimento registrado — ${result.stockEntries} item(ns) deram entrada no estoque` : "Recebimento registrado"
    );
  })
);

// ============================================================
// Histórico de preço
// ============================================================

// GET /api/purchases/price-history?productId= | ?search=
router.get(
  "/price-history",
  requirePermission("purchases.read"),
  asyncHandler(async (req, res) => {
    const productId = req.query.productId ? String(req.query.productId) : undefined;
    const search = String(req.query.search ?? "").trim();
    if (!productId && search.length < 2) throw new BadRequestError("Escolha um produto ou digite ao menos 2 letras");
    const org = req.user!.organizationId;
    const itemFilter: Prisma.PurchaseRequestItemWhereInput = productId
      ? { productId }
      : { description: { contains: search, mode: "insensitive" } };

    const [quotes, orders] = await Promise.all([
      prisma.purchaseQuoteItem.findMany({
        where: { requestItem: itemFilter, quote: { request: { organizationId: org } } },
        include: { quote: { select: { createdAt: true, selected: true, supplier: { select: { id: true, name: true } }, request: { select: { number: true } } } }, requestItem: { select: { description: true } } },
        orderBy: { quote: { createdAt: "desc" } },
        take: 200,
      }),
      prisma.purchaseOrderItem.findMany({
        where: {
          ...(productId ? { productId } : { description: { contains: search, mode: "insensitive" } }),
          order: { organizationId: org, status: { not: "CANCELLED" } },
        },
        include: { order: { select: { number: true, createdAt: true, status: true, supplier: { select: { id: true, name: true } } } } },
        orderBy: { order: { createdAt: "desc" } },
        take: 200,
      }),
    ]);

    const points = [
      ...quotes.map((q) => ({
        date: q.quote.createdAt,
        source: "QUOTE" as const,
        reference: q.quote.request.number,
        description: q.requestItem.description,
        supplier: q.quote.supplier,
        unitPrice: money(q.unitPrice),
        selected: q.quote.selected,
      })),
      ...orders.map((o) => ({
        date: o.order.createdAt,
        source: "ORDER" as const,
        reference: o.order.number,
        description: o.description,
        supplier: o.order.supplier,
        unitPrice: money(o.unitPrice),
        selected: true,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const pagos = points.filter((p) => p.source === "ORDER").map((p) => p.unitPrice);
    return ok(res, {
      points,
      stats: pagos.length
        ? {
            last: pagos[0],
            min: Math.min(...pagos),
            max: Math.max(...pagos),
            avg: round2(pagos.reduce((s, n) => s + n, 0) / pagos.length),
            // variação do último pedido contra o anterior
            change: pagos.length > 1 && pagos[1] > 0 ? round2(((pagos[0] - pagos[1]) / pagos[1]) * 100) : null,
          }
        : null,
    });
  })
);

export default router;
