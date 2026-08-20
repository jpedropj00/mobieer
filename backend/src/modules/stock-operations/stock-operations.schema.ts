import { z } from "zod";

export const transferSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  originWarehouseId: z.string().min(1),
  destinationWarehouseId: z.string().min(1),
  reason: z.string().trim().min(3),
});

export const reservationSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().optional().nullable(),
  note: z.string().trim().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const reservationActionSchema = z.object({
  action: z.enum(["FULFILL", "CANCEL"]),
  note: z.string().trim().optional().nullable(),
});

export const occurrenceSchema = z.object({
  type: z.enum(["RETURN", "LOSS", "DAMAGE"]),
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().optional().nullable(),
  reason: z.string().trim().min(3),
});

export const usageQuery = z.object({
  days: z.coerce.number().int().min(1).max(730).default(90),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type TransferInput = z.infer<typeof transferSchema>;
export type ReservationInput = z.infer<typeof reservationSchema>;
export type OccurrenceInput = z.infer<typeof occurrenceSchema>;
