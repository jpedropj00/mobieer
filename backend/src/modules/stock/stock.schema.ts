import { z } from "zod";
import { MovementType } from "@prisma/client";

export const entryItemSchema = z.object({
  productId: z.string().min(1, "Produto obrigatório"),
  quantity: z.number().int().positive("Quantidade deve ser maior que zero"),
  unitValue: z.number().nonnegative().optional().nullable(),
  batch: z.string().optional().nullable(),
});

export const entrySchema = z.object({
  supplierId: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  date: z.string().datetime().optional(),
  note: z.string().optional().nullable(),
  items: z.array(entryItemSchema).min(1, "Adicione ao menos um produto"),
});

export const exitItemSchema = z.object({
  productId: z.string().min(1, "Produto obrigatório"),
  quantity: z.number().int().positive("Quantidade deve ser maior que zero"),
});

export const exitSchema = z.object({
  requesterName: z.string().optional().nullable(),
  sector: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  date: z.string().datetime().optional(),
  reason: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  requisitionId: z.string().optional().nullable(),
  items: z.array(exitItemSchema).min(1, "Adicione ao menos um produto"),
});

export const adjustSchema = z.object({
  productId: z.string().min(1, "Produto obrigatório"),
  newStock: z.number().int().min(0, "Estoque não pode ser negativo"),
  reason: z.string().min(3, "Informe o motivo do ajuste"),
  inventoryItemId: z.string().optional().nullable(),
});

export const movementsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(MovementType).optional(),
  productId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

export type EntryInput = z.infer<typeof entrySchema>;
export type ExitInput = z.infer<typeof exitSchema>;
export type AdjustInput = z.infer<typeof adjustSchema>;
