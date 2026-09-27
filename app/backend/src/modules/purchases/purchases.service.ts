/**
 * §30 — Compras. Operações com banco: numeração, recebimento com entrada no
 * estoque, conta a pagar do pedido e o aviso diário de entrega atrasada.
 */
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { notifyUsersWithPermission } from "../../lib/notify";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { registerEntry } from "../stock/stock.service";
import { aceitaRecebimento, conferirRecebimento, statusAposRecebimento, totalPedido } from "./purchases.rules";

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
const money = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

/** Próximo número SC-/PC-. O número é único no banco; em corrida, quem chama tenta de novo. */
export async function nextNumber(kind: "request" | "order", tx: Tx | typeof prisma = prisma) {
  const prefix = kind === "request" ? "SC" : "PC";
  const last =
    kind === "request"
      ? await tx.purchaseRequest.findFirst({ orderBy: { number: "desc" }, select: { number: true } })
      : await tx.purchaseOrder.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.replace(/\D/g, ""), 10) + 1 : 1;
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

/** Repete a criação quando dois usuários pegam o mesmo número ao mesmo tempo. */
export async function withNumberRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const dup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target ?? "").includes("number");
      if (!dup || attempt >= 2) throw e;
    }
  }
}

/**
 * Registra um recebimento. Tudo na mesma transação: linhas do recebimento,
 * saldo recebido do pedido, entrada no estoque (itens com produto cadastrado),
 * último custo do produto e status do pedido.
 */
export async function receiveOrder(opts: {
  orderId: string;
  organizationId: string;
  actorId: string;
  invoiceNumber?: string | null;
  notes?: string | null;
  warehouseId?: string | null;
  receivedAt?: Date | null;
  lines: { orderItemId: string; quantity: number }[];
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: opts.orderId, organizationId: opts.organizationId },
      include: { items: true },
    });
    if (!order) throw new NotFoundError("Pedido não encontrado");
    if (!aceitaRecebimento(order.status)) {
      throw new BadRequestError(order.status === "DRAFT" ? "Envie o pedido ao fornecedor antes de receber" : "Este pedido não aceita mais recebimento");
    }
    const conf = conferirRecebimento(order.items, opts.lines);
    if (!conf.ok) throw new BadRequestError(conf.motivo);

    if (opts.warehouseId) {
      const wh = await tx.warehouse.findUnique({ where: { id: opts.warehouseId }, select: { id: true } });
      if (!wh) throw new BadRequestError("Almoxarifado inválido");
    }

    const receipt = await tx.purchaseReceipt.create({
      data: {
        orderId: order.id,
        receivedAt: opts.receivedAt ?? new Date(),
        invoiceNumber: opts.invoiceNumber || null,
        notes: opts.notes || null,
        warehouseId: opts.warehouseId || null,
        receivedById: opts.actorId,
      },
    });

    const itemById = new Map(order.items.map((i) => [i.id, i]));
    const comProduto = opts.lines.filter((l) => itemById.get(l.orderItemId)!.productId);

    // entrada no estoque pelo mesmo caminho da tela de entrada
    const movimentos = comProduto.length
      ? await registerEntry(
          tx,
          {
            supplierId: order.supplierId,
            invoiceNumber: opts.invoiceNumber || null,
            date: (opts.receivedAt ?? new Date()).toISOString(),
            note: `Recebimento do pedido ${order.number}`,
            items: comProduto.map((l) => {
              const item = itemById.get(l.orderItemId)!;
              return { productId: item.productId!, quantity: l.quantity, unitValue: money(item.unitPrice), warehouseId: opts.warehouseId || null };
            }),
          },
          opts.actorId
        )
      : [];

    let mi = 0;
    for (const l of opts.lines) {
      const item = itemById.get(l.orderItemId)!;
      const movement = item.productId ? movimentos[mi++] : undefined;
      await tx.purchaseReceiptItem.create({
        data: { receiptId: receipt.id, orderItemId: item.id, quantity: l.quantity, stockMovementId: movement?.id ?? null },
      });
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: { increment: l.quantity } } });
      item.receivedQty += l.quantity;
      // último custo de compra vira o valor unitário do produto (base do custo por projeto)
      if (item.productId) await tx.product.update({ where: { id: item.productId }, data: { unitValue: item.unitPrice } });
    }

    const status: PurchaseOrderStatus = statusAposRecebimento(order.items);
    const updated = await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status, receivedAt: status === "RECEIVED" ? new Date() : null },
    });

    await tx.auditLog.create({
      data: {
        userId: opts.actorId,
        action: "PURCHASE_RECEIVED",
        entity: "PurchaseOrder",
        entityId: order.id,
        details: { number: order.number, receiptId: receipt.id, lines: opts.lines, status, invoiceNumber: opts.invoiceNumber ?? null },
      },
    });

    return { receipt, order: updated, stockEntries: movimentos.length };
  });
}

/**
 * Conta a pagar do pedido emitido. Idempotente: o vínculo é único, então
 * reenviar ou repetir a chamada não gera segundo lançamento.
 */
export async function ensurePayable(tx: Tx, orderId: string, actorId: string) {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { items: true, supplier: { select: { name: true } } },
  });
  if (!order) throw new NotFoundError("Pedido não encontrado");
  if (order.financeTransactionId) return order.financeTransactionId;

  const total = totalPedido(
    order.items.map((i) => ({ quantity: i.quantity, unitPrice: money(i.unitPrice) })),
    money(order.freight)
  );
  if (total <= 0) return null;

  const hoje = new Date();
  const vencimento = order.expectedDeliveryAt ?? new Date(hoje.getTime() + 30 * DAY_MS);
  const tx1 = await tx.financeTransaction.create({
    data: {
      organizationId: order.organizationId,
      type: "DESPESA",
      category: "Compras de materiais",
      amount: total,
      date: hoje,
      dueDate: vencimento,
      description: `Pedido de compra ${order.number} — ${order.supplier.name}`,
      status: "PENDENTE",
      supplierId: order.supplierId,
      projectId: order.projectId,
      purchaseRef: order.number,
      createdById: actorId,
    },
  });
  await tx.purchaseOrder.update({ where: { id: order.id }, data: { financeTransactionId: tx1.id } });
  return tx1.id;
}

/**
 * Aviso diário de pedido com entrega vencida e ainda não recebido por inteiro.
 * Um aviso por pedido a cada 3 dias, para não virar ruído.
 */
export async function runPurchaseDeliveryAlerts(now = new Date()) {
  const late = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
      expectedDeliveryAt: { lt: now },
      OR: [{ lateAlertAt: null }, { lateAlertAt: { lt: new Date(now.getTime() - 3 * DAY_MS) } }],
    },
    select: { id: true, number: true, organizationId: true, expectedDeliveryAt: true, supplier: { select: { name: true } } },
  });
  let notified = 0;
  for (const o of late) {
    const dias = Math.floor((now.getTime() - o.expectedDeliveryAt!.getTime()) / DAY_MS);
    notified += await notifyUsersWithPermission({
      organizationId: o.organizationId,
      permission: "purchases.manage",
      title: "Entrega de compra atrasada",
      message: `Pedido ${o.number} (${o.supplier.name}) venceu a previsão de entrega há ${dias} dia(s).`,
    });
    await prisma.purchaseOrder.update({ where: { id: o.id }, data: { lateAlertAt: now } });
  }
  return { late: late.length, notified };
}
