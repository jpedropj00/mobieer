import { prisma } from "../../prisma";
import { NotFoundError, BadRequestError } from "../../utils/ApiError";
import { nextCode, toDecimal } from "../../utils/helpers";
import type { ProductInput } from "./products.schema";

export type StockStatus = "NORMAL" | "ATENCAO" | "CRITICO" | "SEM_ESTOQUE";

export function computeStockStatus(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return "SEM_ESTOQUE";
  if (minStock > 0 && stock <= Math.ceil(minStock / 2)) return "CRITICO";
  if (minStock > 0 && stock <= minStock) return "ATENCAO";
  return "NORMAL";
}

export function serializeProduct(p: {
  id: string;
  name: string;
  code: string;
  sku: string | null;
  description: string | null;
  unit: string;
  stock: number;
  minStock: number;
  maxStock: number | null;
  unitValue: { toNumber(): number } | null;
  imageUrl: string | null;
  status: string;
  corridor: string | null;
  shelf: string | null;
  position: string | null;
  createdAt: Date;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  warehouse: { id: string; name: string; code: string } | null;
}) {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    sku: p.sku,
    description: p.description,
    unit: p.unit,
    stock: p.stock,
    minStock: p.minStock,
    maxStock: p.maxStock,
    unitValue: p.unitValue ? Number(p.unitValue.toNumber()) : null,
    imageUrl: p.imageUrl,
    status: p.status,
    location: p.warehouse
      ? {
          warehouseId: p.warehouse.id,
          warehouse: p.warehouse.name,
          corridor: p.corridor,
          shelf: p.shelf,
          position: p.position,
          full: `${p.warehouse.name}${p.corridor ? ` / Corredor ${p.corridor}` : ""}${p.shelf ? ` / Prateleira ${p.shelf}` : ""}${p.position ? ` / Posição ${p.position}` : ""}`,
        }
      : null,
    category: p.category,
    supplier: p.supplier,
    stockStatus: computeStockStatus(p.stock, p.minStock),
    createdAt: p.createdAt,
  };
}

const include = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
};

export async function listProducts(params: {
  page: number;
  perPage: number;
  search?: string;
  categoryId?: string;
  status?: string;
  warehouseId?: string;
  lowStock?: string;
}) {
  const where: Record<string, unknown> = {};

  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: "insensitive" as const } },
      { code: { contains: params.search, mode: "insensitive" as const } },
      { sku: { contains: params.search, mode: "insensitive" as const } },
    ];
  }
  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.status) where.status = params.status;
  if (params.warehouseId) where.warehouseId = params.warehouseId;
  if (params.lowStock === "true") {
    where.OR = [...(where.OR ?? []), { stock: { lte: prisma.product.fields.minStock } }];
  }

  const total = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const products = await prisma.product.findMany({
    where,
    include,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    skip: (params.page - 1) * params.perPage,
    take: params.perPage,
  });

  return {
    items: products.map(serializeProduct),
    meta: { page: params.page, perPage: params.perPage, total, pages },
  };
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include });
  if (!product) throw new NotFoundError("Produto não encontrado");
  return serializeProduct(product);
}

export async function getProductByCode(code: string) {
  const product = await prisma.product.findUnique({ where: { code }, include });
  if (!product) throw new NotFoundError("Produto não encontrado");
  return serializeProduct(product);
}

export async function createProduct(input: ProductInput, actorId: string) {
  const code = await nextCode("product", "MAT");

  const product = await prisma.product.create({
    data: {
      name: input.name,
      code,
      sku: input.sku ?? null,
      description: input.description ?? null,
      unit: input.unit,
      stock: 0,
      minStock: input.minStock,
      maxStock: input.maxStock ?? null,
      unitValue: toDecimal(input.unitValue),
      status: input.status,
      categoryId: input.categoryId ?? null,
      supplierId: input.supplierId ?? null,
      warehouseId: input.warehouseId ?? null,
      corridor: input.corridor ?? null,
      shelf: input.shelf ?? null,
      position: input.position ?? null,
    },
    include,
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: product.id,
      details: { code, name: product.name },
    },
  });

  return serializeProduct(product);
}

export async function updateProduct(id: string, input: Partial<ProductInput>, actorId: string) {
  await getProduct(id);

  const product = await prisma.product.update({
    where: { id },
    data: {
      name: input.name,
      sku: input.sku === undefined ? undefined : input.sku,
      description: input.description,
      unit: input.unit,
      minStock: input.minStock,
      maxStock: input.maxStock,
      unitValue: toDecimal(input.unitValue),
      status: input.status,
      categoryId: input.categoryId === undefined ? undefined : input.categoryId,
      supplierId: input.supplierId === undefined ? undefined : input.supplierId,
      warehouseId: input.warehouseId === undefined ? undefined : input.warehouseId,
      corridor: input.corridor,
      shelf: input.shelf,
      position: input.position,
    },
    include,
  });

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "PRODUCT_UPDATED",
      entity: "Product",
      entityId: product.id,
      details: { code: product.code, name: product.name },
    },
  });

  return serializeProduct(product);
}

export async function setProductImage(id: string, imageUrl: string, actorId: string) {
  await getProduct(id);
  const product = await prisma.product.update({
    where: { id },
    data: { imageUrl },
    include,
  });
  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "PRODUCT_UPDATED",
      entity: "Product",
      entityId: product.id,
      details: { code: product.code, imageChanged: true },
    },
  });
  return serializeProduct(product);
}

export async function deleteProduct(id: string, actorId: string) {
  await getProduct(id);

  // Soft delete: products with history must not be hard-deleted
  const movementCount = await prisma.stockMovement.count({ where: { productId: id } });
  if (movementCount > 0) {
    const product = await prisma.product.update({
      where: { id },
      data: { status: "INACTIVE" },
      include,
    });
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: "PRODUCT_DEACTIVATED",
        entity: "Product",
        entityId: product.id,
        details: { code: product.code, hasMovements: true },
      },
    });
    return { ...serializeProduct(product), softDeleted: true };
  }

  const product = await prisma.product.delete({ where: { id }, include });
  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "PRODUCT_DELETED",
      entity: "Product",
      entityId: product.id,
      details: { code: product.code },
    },
  });
  return { deleted: true };
}

export async function ensureStockAvailable(productId: string, quantity: number) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Produto não encontrado");
  if (product.stock < quantity) {
    throw new BadRequestError(`Estoque insuficiente para "${product.name}". Disponível: ${product.stock}`);
  }
  return product;
}
