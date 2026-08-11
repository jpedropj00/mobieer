import { z } from "zod";
import { RequisitionStatus } from "@prisma/client";

export const createRequisitionSchema = z.object({
  sector: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Produto obrigatório"),
        quantity: z.number().int().positive("Quantidade deve ser maior que zero"),
      })
    )
    .min(1, "Adicione ao menos um produto"),
});

export const updateStatusSchema = z.object({
  status: z.nativeEnum(RequisitionStatus),
  note: z.string().optional().nullable(),
});

export const requisitionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(RequisitionStatus).optional(),
  search: z.string().optional(),
  my: z.enum(["true", "false"]).optional(),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
