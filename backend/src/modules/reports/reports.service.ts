import { MovementType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";
import { daysAgo, num } from "../../utils/helpers";
import type { ReportFilters, ReportType } from "./reports.schema";

const movementInclude = {
  product: { select: { id: true, name: true, code: true, unit: true } },
  responsible: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  requisition: { select: { id: true, number: true } },
} satisfies Prisma.StockMovementInclude;

function serializeMovement(m: {
  id: string;
  type: string;
  quantity: number;
  unitValue: { toNumber(): number } | null;
  date: Date;
  note: string | null;
  invoiceNumber: string | null;
  batch: string | null;
  requesterName: string | null;
  sector: string | null;
  destination: string | null;
  reason: string | null;
  product: { id: string; name: string; code: string; unit: string };
  responsible: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  requisition: { id: string; number: string } | null;
}) {
  return {
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
  };
}

function movementWhere(f: ReportFilters, type?: MovementType): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = {};
  if (type) where.type = type;
  if (f.dateFrom || f.dateTo) {
    where.date = {
      ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}),
      ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}),
    };
  }
  if (f.productId) where.productId = f.productId;
  if (f.responsibleId) where.responsibleId = f.responsibleId;
  if (f.sector) where.sector = { contains: f.sector, mode: "insensitive" };
  return where;
}

async function movementsData(f: ReportFilters, type?: MovementType, limit = 1000) {
  const movements = await prisma.stockMovement.findMany({
    where: movementWhere(f, type),
    include: movementInclude,
    orderBy: { date: "desc" },
    take: limit,
  });
  return movements.map(serializeMovement);
}

export async function runReport(type: ReportType, f: ReportFilters) {
  switch (type) {
    case "stock": {
      const where: Prisma.ProductWhereInput = { status: "ACTIVE" };
      if (f.categoryId) where.categoryId = f.categoryId;
      if (f.productId) where.id = f.productId;
      const products = await prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      });
      return products.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        sku: p.sku,
        unit: p.unit,
        stock: p.stock,
        minStock: p.minStock,
        maxStock: p.maxStock,
        unitValue: p.unitValue ? Number(p.unitValue) : null,
        category: p.category?.name ?? null,
        warehouse: p.warehouse?.name ?? null,
        location: p.corridor ? `${p.warehouse?.name ?? ""} / Corredor ${p.corridor} / Prateleira ${p.shelf ?? "-"} / Posição ${p.position ?? "-"}` : null,
      }));
    }
    case "entries":
      return movementsData(f, MovementType.ENTRY);
    case "exits":
      return movementsData(f, MovementType.EXIT);
    case "movements":
      return movementsData(f, f.type);
    case "low-stock": {
      const products = await prisma.product.findMany({
        where: { status: "ACTIVE", stock: { lte: prisma.product.fields.minStock }, ...(f.categoryId ? { categoryId: f.categoryId } : {}) },
        include: { category: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } },
        orderBy: [{ stock: "asc" }],
      });
      return products.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        stock: p.stock,
        minStock: p.minStock,
        deficit: p.minStock - p.stock,
        category: p.category?.name ?? null,
        warehouse: p.warehouse?.name ?? null,
      }));
    }
    case "inactive-products": {
      const movements = await prisma.stockMovement.findMany({
        where: { type: MovementType.EXIT, ...(f.dateFrom ? { date: { gte: new Date(f.dateFrom) } } : {}) },
        select: { productId: true },
      });
      const movedIds = new Set(movements.map((m) => m.productId));
      const products = await prisma.product.findMany({
        where: { status: "ACTIVE", id: { notIn: [...movedIds] }, ...(f.categoryId ? { categoryId: f.categoryId } : {}) },
        include: { category: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
      });
      return products.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        stock: p.stock,
        category: p.category?.name ?? null,
        lastMovement: null,
      }));
    }
    case "inventories": {
      const inventories = await prisma.inventory.findMany({
        include: {
          startedBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return inventories.map((inv) => ({
        id: inv.id,
        name: inv.name,
        status: inv.status,
        startedBy: inv.startedBy.name,
        itemCount: inv._count.items,
        createdAt: inv.createdAt,
        concludedAt: inv.concludedAt,
      }));
    }
    case "consumption-period": {
      const movements = await prisma.stockMovement.findMany({
        where: { type: MovementType.EXIT, ...(f.dateFrom ? { date: { gte: new Date(f.dateFrom) } } : {}), ...(f.dateTo ? { date: { lte: new Date(f.dateTo) } } : {}) },
        select: { quantity: true, date: true },
      });
      const byDay = new Map<string, number>();
      for (const m of movements) {
        const key = m.date.toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) ?? 0) + m.quantity);
      }
      return [...byDay.entries()]
        .map(([date, quantity]) => ({ date, quantity }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    case "consumption-sector": {
      const movements = await prisma.stockMovement.findMany({
        where: { type: MovementType.EXIT, sector: { not: null }, ...(f.dateFrom ? { date: { gte: new Date(f.dateFrom) } } : {}) },
        select: { sector: true, quantity: true },
      });
      const bySector = new Map<string, number>();
      for (const m of movements) {
        const sector = m.sector ?? "Não informado";
        bySector.set(sector, (bySector.get(sector) ?? 0) + m.quantity);
      }
      return [...bySector.entries()]
        .map(([sector, quantity]) => ({ sector, quantity }))
        .sort((a, b) => b.quantity - a.quantity);
    }
    case "consumption-employee": {
      const movements = await prisma.stockMovement.findMany({
        where: { type: MovementType.EXIT, requesterName: { not: null }, ...(f.dateFrom ? { date: { gte: new Date(f.dateFrom) } } : {}) },
        select: { requesterName: true, quantity: true },
      });
      const byEmployee = new Map<string, number>();
      for (const m of movements) {
        const employee = m.requesterName ?? "Não informado";
        byEmployee.set(employee, (byEmployee.get(employee) ?? 0) + m.quantity);
      }
      return [...byEmployee.entries()]
        .map(([employee, quantity]) => ({ employee, quantity }))
        .sort((a, b) => b.quantity - a.quantity);
    }
    default:
      return [];
  }
}

export async function getProductHistory(productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Produto não encontrado");
  const movements = await prisma.stockMovement.findMany({
    where: { productId },
    include: movementInclude,
    orderBy: { date: "desc" },
  });
  let running = product.stock;
  const oldestFirst = [...movements].reverse();
  const timeline = oldestFirst.map((m) => {
    if (m.type === "ENTRY") running -= m.quantity;
    if (m.type === "EXIT") running += m.quantity;
    return { ...serializeMovement(m), balanceAfter: running };
  });
  const byId = new Map(timeline.map((t) => [t.id, t.balanceAfter]));
  return {
    product: {
      id: product.id,
      name: product.name,
      code: product.code,
      sku: product.sku,
      unit: product.unit,
      stock: product.stock,
      minStock: product.minStock,
    },
    movements: movements.map((m) => ({
      ...serializeMovement(m),
      balanceAfter: byId.get(m.id) ?? m.quantity,
    })),
  };
}
