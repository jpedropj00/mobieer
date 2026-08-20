import { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { num, toDecimal } from "../../utils/helpers";
import { computeStockStatus } from "../products/products.service";
import type { AdjustInput, EntryInput, ExitInput } from "./stock.schema";

async function checkLowStock(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, stock: true, minStock: true },
  });
  if (!product) return;

  if (product.minStock > 0 && product.stock <= product.minStock) {
    const existing = await prisma.notification.findFirst({
      where: {
        productId,
        type: product.stock === 0 ? NotificationType.OUT_OF_STOCK : NotificationType.LOW_STOCK,
        read: false,
      },
    });
    if (!existing) {
      await prisma.notification.create({
        data: {
          type: product.stock === 0 ? NotificationType.OUT_OF_STOCK : NotificationType.LOW_STOCK,
          title: product.stock === 0 ? "Produto sem estoque" : "Estoque abaixo do mínimo",
          message: `${product.name}: ${product.stock} un. disponíveis (mínimo ${product.minStock})`,
          productId: product.id,
        },
      });
    }
  }
}

export async function createEntry(input: EntryInput, actorId: string, actorName: string) {
  if (!input.items.length) throw new BadRequestError("Adicione ao menos um produto");

  const movements = await prisma.$transaction(async (tx) => {
    const created: { id: string; productId: string; productName: string; quantity: number }[] = [];

    for (const item of input.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw new NotFoundError("Produto não encontrado");

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      const warehouseId = item.warehouseId ?? product.warehouseId;
      if (warehouseId) {
        await tx.productWarehouseStock.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId } },
          create: { productId: item.productId, warehouseId, quantity: item.quantity },
          update: { quantity: { increment: item.quantity } },
        });
      }

      const movement = await tx.stockMovement.create({
        data: {
          type: "ENTRY",
          productId: item.productId,
          quantity: item.quantity,
          unitValue: toDecimal(item.unitValue),
          date: input.date ? new Date(input.date) : new Date(),
          note: input.note ?? null,
          supplierId: input.supplierId ?? null,
          invoiceNumber: input.invoiceNumber ?? null,
          batch: item.batch ?? null,
          destinationWarehouseId: warehouseId,
          responsibleId: actorId,
        },
      });

      created.push({ id: movement.id, productId: item.productId, productName: product.name, quantity: item.quantity });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "STOCK_ENTRY",
        entity: "StockMovement",
        entityId: created.map((c) => c.id).join(","),
        details: { items: created, invoiceNumber: input.invoiceNumber, supplierId: input.supplierId },
      },
    });

    for (const c of created) {
      await checkLowStockWith(tx, c.productId);
    }

    return created;
  });

  return { movements, count: movements.reduce((acc, m) => acc + m.quantity, 0), actor: actorName };
}

type Tx = Prisma.TransactionClient;

async function checkLowStockWith(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, stock: true, minStock: true },
  });
  if (!product) return;
  if (product.minStock > 0 && product.stock <= product.minStock) {
    const existing = await tx.notification.findFirst({
      where: {
        productId,
        type: product.stock === 0 ? NotificationType.OUT_OF_STOCK : NotificationType.LOW_STOCK,
        read: false,
      },
    });
    if (!existing) {
      await tx.notification.create({
        data: {
          type: product.stock === 0 ? NotificationType.OUT_OF_STOCK : NotificationType.LOW_STOCK,
          title: product.stock === 0 ? "Produto sem estoque" : "Estoque abaixo do mínimo",
          message: `${product.name}: ${product.stock} un. disponíveis (mínimo ${product.minStock})`,
          productId: product.id,
        },
      });
    }
  }
}

async function createExitWithClient(
  tx: Tx,
  input: ExitInput,
  actorId: string,
  actorName: string,
  allowNegative = false
) {
  if (!input.items.length) throw new BadRequestError("Adicione ao menos um produto");

  const created: { id: string; productId: string; productName: string; quantity: number }[] = [];

  for (const item of input.items) {
    const product = await tx.product.findUnique({ where: { id: item.productId } });
    if (!product) throw new NotFoundError("Produto não encontrado");

    if (allowNegative) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    } else {
      const updated = await tx.$executeRaw`
        UPDATE "Product"
        SET "stock" = "stock" - ${item.quantity}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${item.productId}
          AND ("stock" - "reservedStock") >= ${item.quantity}
      `;
      if (!updated) {
        const current = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stock: true },
        });
        throw new BadRequestError(
          `Estoque disponível insuficiente para "${product.name}". Disponível: ${Math.max(0, (current?.stock ?? 0) - product.reservedStock)}, solicitado: ${item.quantity}`
        );
      }
    }

    const warehouseId = item.warehouseId ?? product.warehouseId;
    if (warehouseId) {
      const balance = await tx.productWarehouseStock.updateMany({
        where: allowNegative
          ? { productId: item.productId, warehouseId }
          : { productId: item.productId, warehouseId, quantity: { gte: item.quantity } },
        data: { quantity: { decrement: item.quantity } },
      });
      if (!balance.count) throw new BadRequestError(`Saldo insuficiente de "${product.name}" no almoxarifado selecionado`);
    }

    const movement = await tx.stockMovement.create({
      data: {
        type: "EXIT",
        productId: item.productId,
        quantity: item.quantity,
        date: input.date ? new Date(input.date) : new Date(),
        note: input.note ?? null,
        requesterName: input.requesterName ?? null,
        sector: input.sector ?? null,
        destination: input.destination ?? null,
        reason: input.reason ?? null,
        responsibleId: actorId,
        requisitionId: input.requisitionId ?? null,
        originWarehouseId: warehouseId,
      },
    });

    created.push({ id: movement.id, productId: item.productId, productName: product.name, quantity: item.quantity });
  }

  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: "STOCK_EXIT",
      entity: "StockMovement",
      entityId: created.map((c) => c.id).join(","),
      details: { items: created, requisitionId: input.requisitionId, sector: input.sector },
    },
  });

  for (const c of created) {
    await checkLowStockWith(tx, c.productId);
  }

  return { movements: created, count: created.reduce((acc, m) => acc + m.quantity, 0), actor: actorName };
}

export async function createExit(input: ExitInput, actorId: string, actorName: string, allowNegative = false) {
  return prisma.$transaction((tx) => createExitWithClient(tx, input, actorId, actorName, allowNegative));
}

export { createExitWithClient };

export async function adjustStock(input: AdjustInput, actorId: string, actorName: string) {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new NotFoundError("Produto não encontrado");

  const difference = input.newStock - product.stock;
  if (difference === 0) throw new BadRequestError("O novo estoque é igual ao atual. Nenhum ajuste necessário.");

  const movement = await prisma.$transaction(async (tx) => {
    const m = await tx.stockMovement.create({
      data: {
        type: "ADJUST",
        productId: input.productId,
        quantity: Math.abs(difference),
        note: `Ajuste: ${input.reason}${difference > 0 ? " (acréscimo)" : " (redução)"}`,
        responsibleId: actorId,
        inventoryItemId: input.inventoryItemId ?? null,
      },
    });

    await tx.product.update({
      where: { id: input.productId },
      data: { stock: input.newStock },
    });

    if (input.inventoryItemId) {
      await tx.inventoryItem.update({
        where: { id: input.inventoryItemId },
        data: {
          countedQty: input.newStock,
          difference,
          status: "ADJUSTED",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "STOCK_ADJUST",
        entity: "Product",
        entityId: input.productId,
        details: { from: product.stock, to: input.newStock, reason: input.reason },
      },
    });

    await checkLowStockWith(tx, input.productId);
    return m;
  });

  return {
    movement,
    productId: input.productId,
    from: product.stock,
    to: input.newStock,
    difference,
    actor: actorName,
  };
}

export async function listMovements(params: {
  page: number;
  perPage: number;
  type?: string;
  productId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}) {
  const where: Prisma.StockMovementWhereInput = {};
  if (params.type) where.type = params.type as never;
  if (params.productId) where.productId = params.productId;
  if (params.dateFrom || params.dateTo) {
    where.date = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
    };
  }
  if (params.search) {
    where.product = { name: { contains: params.search, mode: "insensitive" } };
  }

  const total = await prisma.stockMovement.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const movements = await prisma.stockMovement.findMany({
    where,
    include: {
      product: { select: { id: true, name: true, code: true, unit: true } },
      responsible: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      requisition: { select: { id: true, number: true } },
      originWarehouse: { select: { id: true, name: true, code: true } },
      destinationWarehouse: { select: { id: true, name: true, code: true } },
    },
    orderBy: { date: "desc" },
    skip: (params.page - 1) * params.perPage,
    take: params.perPage,
  });

  return {
    items: movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      unitValue: m.unitValue ? Number(m.unitValue) : null,
      date: m.date,
      note: m.note,
      invoiceNumber: m.invoiceNumber,
      batch: m.batch,
      requesterName: m.requesterName,
      sector: m.sector,
      destination: m.destination,
      reason: m.reason,
      product: m.product,
      responsible: m.responsible,
      supplier: m.supplier,
      requisition: m.requisition,
      originWarehouse: m.originWarehouse,
      destinationWarehouse: m.destinationWarehouse,
      operationCode: m.operationCode,
    })),
    meta: { page: params.page, perPage: params.perPage, total, pages },
  };
}

export async function listAlerts() {
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
    },
    orderBy: [{ stock: "asc" }],
  });

  const alerts = products
    .filter((p) => p.stock <= p.minStock)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      code: p.code,
      unit: p.unit,
      stock: p.stock,
      minStock: p.minStock,
      maxStock: p.maxStock,
      status: computeStockStatus(p.stock, p.minStock),
      category: p.category,
      supplier: p.supplier,
      warehouse: p.warehouse,
      location: p.corridor ? `${p.warehouse?.name ?? ""} / Corredor ${p.corridor} / Prateleira ${p.shelf ?? "-"} / Posição ${p.position ?? "-"}` : null,
    }));

  const counts = {
    normal: 0,
    atencao: 0,
    critico: 0,
    semEstoque: 0,
  };
  products.forEach((p) => {
    const status = computeStockStatus(p.stock, p.minStock);
    if (status === "NORMAL") counts.normal += 1;
    else if (status === "ATENCAO") counts.atencao += 1;
    else if (status === "CRITICO") counts.critico += 1;
    else counts.semEstoque += 1;
  });

  return { alerts, counts };
}

export async function stockSummary() {
  const agg = await prisma.product.aggregate({
    where: { status: "ACTIVE" },
    _sum: { stock: true },
    _count: true,
  });

  const atencao = await prisma.product.count({
    where: { status: "ACTIVE", stock: { gt: 0, lte: prisma.product.fields.minStock } },
  });
  const semEstoque = await prisma.product.count({ where: { status: "ACTIVE", stock: 0 } });

  return {
    totalItems: agg._count,
    totalStock: num(agg._sum.stock),
    lowStock: atencao + semEstoque,
    outOfStock: semEstoque,
  };
}
