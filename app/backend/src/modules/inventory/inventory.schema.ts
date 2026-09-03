import { z } from "zod";
import { InventoryStatus } from "@prisma/client";

export const createInventorySchema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  description: z.string().optional().nullable(),
  productIds: z.array(z.string().min(1)).min(1, "Selecione ao menos um produto"),
});

export const updateCountSchema = z.object({
  countedQty: z.number().int().min(0, "Contagem não pode ser negativa"),
});

export const adjustItemSchema = z.object({
  inventoryItemId: z.string().min(1),
  reason: z.string().min(3, "Informe o motivo do ajuste"),
});

export const updateStatusSchema = z.object({
  status: z.nativeEnum(InventoryStatus),
});

export type CreateInventoryInput = z.infer<typeof createInventorySchema>;
