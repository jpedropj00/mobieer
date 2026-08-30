import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as stockService from "./stock.service";
import { adjustSchema, entrySchema, exitSchema, movementsQuery } from "./stock.schema";

export const createEntry = asyncHandler(async (req: Request, res: Response) => {
  const input = entrySchema.parse(req.body);
  const result = await stockService.createEntry(input, req.user!.id, req.user!.name);
  return ok(res, result, "Entrada registrada e estoque atualizado");
});

export const createExit = asyncHandler(async (req: Request, res: Response) => {
  const input = exitSchema.parse(req.body);
  const allowNegative = req.user!.permissions.includes("stock.negative");
  const result = await stockService.createExit(input, req.user!.id, req.user!.name, allowNegative);
  return ok(res, result, "Saída registrada e estoque atualizado");
});

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
  const input = adjustSchema.parse(req.body);
  const result = await stockService.adjustStock(input, req.user!.id, req.user!.name);
  return ok(res, result, "Estoque ajustado");
});

export const listMovements = asyncHandler(async (req: Request, res: Response) => {
  const q = movementsQuery.parse(req.query);
  const result = await stockService.listMovements(q);
  return res.json({ success: true, data: result.items, meta: result.meta });
});

export const listAlerts = asyncHandler(async (_req: Request, res: Response) => {
  const result = await stockService.listAlerts();
  return ok(res, result);
});

export const stockSummary = asyncHandler(async (_req: Request, res: Response) => {
  const result = await stockService.stockSummary();
  return ok(res, result);
});
