import { NotificationType } from "@prisma/client";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import type { CreateInventoryInput } from "./inventory.schema";
import { adjustStock } from "../stock/stock.service";

function serializeInventory(inv: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  concludedAt: Date | null;
  createdAt: Date;
  startedBy: { id: string; name: string };
  _count: { items: number };
}) {
  return {
    id: inv.id,
    name: inv.name,
    description: inv.description,
    status: inv.status,
    concludedAt: inv.concludedAt,
    createdAt: inv.createdAt,
    startedBy: inv.startedBy,
    itemCount: inv._count.items,
  };
}

export async function listInventories(params: { page: number; perPage: number; status?: string; search?: string }) {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.search) where.name = { contains: params.search, mode: "insensitive" };

  const total = await prisma.inventory.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const inventories = await prisma.inventory.findMany({
    where,
    include: {
      startedBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (params.page - 1) * params.perPage,
    take: params.perPage,
  });

  return {
    items: inventories.map(serializeInventory),
    meta: { page: params.page, perPage: params.perPage, total, pages },
  };
}

export async function getInventory(id: string) {
  const inventory = await prisma.inventory.findUnique({
    where: { id },
    include: {
      startedBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            include: {
              category: { select: { id: true, name: true } },
              warehouse: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { product: { name: "asc" } },
      },
    },
  });
  if (!inventory) throw new NotFoundError("Inventário não encontrado");

  const counted = inventory.items.filter((i) => i.status !== "PENDING").length;
  const divergences = inventory.items.filter((i) => i.difference !== null && i.difference !== 0).length;

  return {
    ...serializeInventory({
      id: inventory.id,
      name: inventory.name,
      description: inventory.description,
      status: inventory.status,
      concludedAt: inventory.concludedAt,
      createdAt: inventory.createdAt,
      startedBy: inventory.startedBy,
      _count: { items: inventory.items.length },
    }),
    counted,
    divergences,
    items: inventory.items.map((i) => ({
      id: i.id,
      expectedQty: i.expectedQty,
      countedQty: i.countedQty,
      difference: i.difference,
      status: i.status,
      product: {
        id: i.product.id,
        name: i.product.name,
        code: i.product.code,
        unit: i.product.unit,
        stock: i.product.stock,
        category: i.product.category,
        warehouse: i.product.warehouse,
      },
    })),
  };
}

export async function createInventory(input: CreateInventoryInput, actorId: string) {
  const products = await prisma.product.findMany({
    where: { id: { in: input.productIds } },
    select: { id: true, name: true, stock: true },
  });

  if (products.length !== input.productIds.length) {
    throw new BadRequestError("Um ou mais produtos não foram encontrados");
  }

  const inventory = await prisma.$transaction(async (tx) => {
    const inv = await tx.inventory.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        status: "OPEN",
        startedById: actorId,
        items: {
          create: products.map((p) => ({
            productId: p.id,
            expectedQty: p.stock,
          })),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "INVENTORY_CREATED",
        entity: "Inventory",
        entityId: inv.id,
        details: { name: inv.name, products: products.length },
      },
    });

    return inv;
  });

  return getInventory(inventory.id);
}

export async function updateCount(inventoryId: string, itemId: string, countedQty: number, actorId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, inventoryId },
    include: { inventory: true, product: true },
  });
  if (!item) throw new NotFoundError("Item de inventário não encontrado");
  if (item.inventory.status === "CONCLUDED") throw new BadRequestError("Inventário já concluído");

  const difference = countedQty - item.expectedQty;

  const updated = await prisma.inventoryItem.update({
    where: { id: itemId },
    data: { countedQty, difference, status: "COUNTED" },
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "INVENTORY_COUNT",
      entity: "InventoryItem",
      entityId: itemId,
      details: { product: item.product.name, expected: item.expectedQty, counted: countedQty, difference },
    },
  });

  return updated;
}

export async function adjustItem(inventoryId: string, inventoryItemId: string, reason: string, actorId: string) {
  const item = await prisma.inventoryItem.findFirst({
    where: { id: inventoryItemId, inventoryId },
    include: { inventory: true },
  });
  if (!item) throw new NotFoundError("Item de inventário não encontrado");
  if (item.countedQty === null) throw new BadRequestError("Realize a contagem antes de ajustar o estoque");

  const result = await adjustStock(
    { productId: item.productId, newStock: item.countedQty, reason, inventoryItemId: item.id },
    actorId,
    (await prisma.user.findUnique({ where: { id: actorId } }))?.name ?? ""
  );

  return result;
}

export async function updateStatus(inventoryId: string, status: string, actorId: string) {
  const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!inventory) throw new NotFoundError("Inventário não encontrado");

  const data: { status: string; concludedAt?: Date | null } = { status };
  if (status === "CONCLUDED") data.concludedAt = new Date();

  const updated = await prisma.inventory.update({ where: { id: inventoryId }, data });

  if (status === "CONCLUDED") {
    await prisma.notification.create({
      data: {
        type: NotificationType.INFO,
        title: "Inventário concluído",
        message: `O inventário "${inventory.name}" foi concluído`,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "INVENTORY_STATUS_CHANGED",
      entity: "Inventory",
      entityId: inventoryId,
      details: { from: inventory.status, to: status },
    },
  });

  return updated;
}

export async function autoCreatePendingNotifications() {
  const pending = await prisma.inventory.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } });
  if (pending > 0) {
    const existing = await prisma.notification.findFirst({
      where: { type: NotificationType.INVENTORY_PENDING, read: false },
    });
    if (!existing) {
      await prisma.notification.create({
        data: {
          type: NotificationType.INVENTORY_PENDING,
          title: "Inventário pendente",
          message: `Existem ${pending} inventário(s) em andamento`,
        },
      });
    }
  }
}
