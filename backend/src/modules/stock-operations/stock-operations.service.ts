import { MovementType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import type { OccurrenceInput, ReservationInput, TransferInput } from "./stock-operations.schema";

type Tx = Prisma.TransactionClient;

async function requireProduct(tx: Tx, productId: string) {
  const product = await tx.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Produto não encontrado");
  return product;
}

async function decrementWarehouse(tx: Tx, productId: string, warehouseId: string, quantity: number) {
  const updated = await tx.productWarehouseStock.updateMany({
    where: { productId, warehouseId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (!updated.count) throw new BadRequestError("Saldo insuficiente no almoxarifado de origem");
}

async function incrementWarehouse(tx: Tx, productId: string, warehouseId: string, quantity: number) {
  await tx.productWarehouseStock.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: { productId, warehouseId, quantity },
    update: { quantity: { increment: quantity } },
  });
}

export async function transferStock(input: TransferInput, actorId: string) {
  if (input.originWarehouseId === input.destinationWarehouseId) {
    throw new BadRequestError("Origem e destino devem ser diferentes");
  }
  return prisma.$transaction(async (tx) => {
    const product = await requireProduct(tx, input.productId);
    await decrementWarehouse(tx, input.productId, input.originWarehouseId, input.quantity);
    await incrementWarehouse(tx, input.productId, input.destinationWarehouseId, input.quantity);
    const movement = await tx.stockMovement.create({
      data: {
        type: MovementType.TRANSFER,
        productId: input.productId,
        quantity: input.quantity,
        reason: input.reason,
        responsibleId: actorId,
        originWarehouseId: input.originWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        operationCode: `TRF-${Date.now()}`,
      },
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "STOCK_TRANSFER", entity: "StockMovement", entityId: movement.id, details: input },
    });
    return { movement, product: { id: product.id, name: product.name } };
  });
}

export async function createReservation(input: ReservationInput, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const product = await requireProduct(tx, input.productId);
    if (input.warehouseId) {
      const balance = await tx.productWarehouseStock.findUnique({ where: { productId_warehouseId: { productId: input.productId, warehouseId: input.warehouseId } } });
      if (!balance || balance.quantity < input.quantity) throw new BadRequestError("Saldo insuficiente no almoxarifado selecionado");
    }
    const changed = await tx.$executeRaw`
      UPDATE "Product"
      SET "reservedStock" = "reservedStock" + ${input.quantity}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.productId}
        AND ("stock" - "reservedStock") >= ${input.quantity}
    `;
    if (!changed) throw new BadRequestError(`Estoque disponível insuficiente para reservar "${product.name}"`);
    const reservation = await tx.stockReservation.create({
      data: {
        productId: input.productId,
        quantity: input.quantity,
        warehouseId: input.warehouseId ?? product.warehouseId,
        requesterId: actorId,
        note: input.note ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      include: { product: { select: { id: true, name: true, code: true } }, warehouse: true, requester: { select: { id: true, name: true } } },
    });
    await tx.stockMovement.create({
      data: { type: MovementType.RESERVE, productId: input.productId, quantity: input.quantity, responsibleId: actorId, reservationId: reservation.id, destinationWarehouseId: reservation.warehouseId, note: input.note ?? null },
    });
    return reservation;
  });
}

export async function listReservations(status?: string) {
  return prisma.stockReservation.findMany({
    where: status ? { status: status as never } : undefined,
    include: { product: { select: { id: true, name: true, code: true, unit: true } }, warehouse: { select: { id: true, name: true } }, requester: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveReservation(id: string, action: "FULFILL" | "CANCEL", actorId: string, note?: string | null) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.stockReservation.findUnique({ where: { id }, include: { product: true } });
    if (!reservation) throw new NotFoundError("Reserva não encontrada");
    if (reservation.status !== "ACTIVE") throw new BadRequestError("Reserva já finalizada");

    if (action === "FULFILL") {
      const changed = await tx.$executeRaw`
        UPDATE "Product"
        SET "stock" = "stock" - ${reservation.quantity},
            "reservedStock" = "reservedStock" - ${reservation.quantity},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${reservation.productId}
          AND "stock" >= ${reservation.quantity}
          AND "reservedStock" >= ${reservation.quantity}
      `;
      if (!changed) throw new BadRequestError("Saldo inconsistente para atender a reserva");
      if (reservation.warehouseId) await decrementWarehouse(tx, reservation.productId, reservation.warehouseId, reservation.quantity);
    } else {
      await tx.product.update({ where: { id: reservation.productId }, data: { reservedStock: { decrement: reservation.quantity } } });
    }

    const updated = await tx.stockReservation.update({
      where: { id },
      data: { status: action === "FULFILL" ? "FULFILLED" : "CANCELLED", note: note ?? reservation.note },
    });
    await tx.stockMovement.create({
      data: {
        type: action === "FULFILL" ? MovementType.EXIT : MovementType.RELEASE,
        productId: reservation.productId,
        quantity: reservation.quantity,
        responsibleId: actorId,
        reservationId: id,
        originWarehouseId: reservation.warehouseId,
        note: note ?? reservation.note,
        reason: action === "FULFILL" ? "Atendimento de reserva" : "Cancelamento de reserva",
      },
    });
    return updated;
  });
}

export async function registerOccurrence(input: OccurrenceInput, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const product = await requireProduct(tx, input.productId);
    const warehouseId = input.warehouseId ?? product.warehouseId;
    const isReturn = input.type === "RETURN";
    if (isReturn) {
      await tx.product.update({ where: { id: input.productId }, data: { stock: { increment: input.quantity } } });
      if (warehouseId) await incrementWarehouse(tx, input.productId, warehouseId, input.quantity);
    } else {
      const changed = await tx.$executeRaw`
        UPDATE "Product"
        SET "stock" = "stock" - ${input.quantity}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.productId}
          AND ("stock" - "reservedStock") >= ${input.quantity}
      `;
      if (!changed) throw new BadRequestError("Estoque disponível insuficiente para registrar a ocorrência");
      if (warehouseId) await decrementWarehouse(tx, input.productId, warehouseId, input.quantity);
    }
    const movement = await tx.stockMovement.create({
      data: { type: input.type as MovementType, productId: input.productId, quantity: input.quantity, responsibleId: actorId, reason: input.reason, originWarehouseId: isReturn ? null : warehouseId, destinationWarehouseId: isReturn ? warehouseId : null },
    });
    await tx.auditLog.create({ data: { userId: actorId, action: `STOCK_${input.type}`, entity: "StockMovement", entityId: movement.id, details: input } });
    return movement;
  });
}

export async function usageAnalytics(days: number, limit: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [mostUsed, stagnant] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { type: { in: ["EXIT", "LOSS", "DAMAGE"] }, date: { gte: since } },
      _sum: { quantity: true },
      _count: true,
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE", movements: { none: { date: { gte: since } } } },
      select: { id: true, name: true, code: true, stock: true, unit: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    }),
  ]);
  const products = await prisma.product.findMany({ where: { id: { in: mostUsed.map((x) => x.productId) } }, select: { id: true, name: true, code: true, unit: true, stock: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  return { mostUsed: mostUsed.map((x) => ({ product: byId.get(x.productId), quantity: x._sum.quantity ?? 0, movements: x._count })), stagnant, periodDays: days };
}
