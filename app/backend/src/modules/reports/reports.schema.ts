import { z } from "zod";
import { MovementType } from "@prisma/client";

export const reportType = z.enum([
  "stock",
  "entries",
  "exits",
  "movements",
  "low-stock",
  "inactive-products",
  "inventories",
  "consumption-period",
  "consumption-sector",
  "consumption-employee",
]);

export const reportQuery = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  productId: z.string().optional(),
  categoryId: z.string().optional(),
  sector: z.string().optional(),
  responsibleId: z.string().optional(),
  type: z.nativeEnum(MovementType).optional(),
});

export const exportQuery = z.object({
  format: z.enum(["pdf", "xlsx"]).default("pdf"),
  productId: z.string().optional(),
});

export type ReportType = z.infer<typeof reportType>;
export type ReportFilters = z.infer<typeof reportQuery>;
