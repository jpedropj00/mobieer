import { z } from "zod";
import { ProductStatus, Unit } from "@prisma/client";

export const productSchema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unit: z.nativeEnum(Unit).default(Unit.UNIT),
  minStock: z.number().int().min(0).default(0),
  maxStock: z.number().int().min(0).optional().nullable(),
  unitValue: z.number().nonnegative().optional().nullable(),
  status: z.nativeEnum(ProductStatus).default(ProductStatus.ACTIVE),
  categoryId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  corridor: z.string().optional().nullable(),
  shelf: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
});

export const productListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  warehouseId: z.string().optional(),
  lowStock: z.enum(["true", "false"]).optional(),
});

export type ProductInput = z.infer<typeof productSchema>;
