import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as inventoryService from "./inventory.service";
import { adjustItemSchema, createInventorySchema, updateCountSchema, updateStatusSchema } from "./inventory.schema";

export const listInventories = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
  const result = await inventoryService.listInventories({
    page,
    perPage,
    status: req.query.status as string | undefined,
    search: req.query.search as string | undefined,
  });
  return res.json({ success: true, data: result.items, meta: result.meta });
});

export const getInventory = asyncHandler(async (req: Request, res: Response) => {
  const inventory = await inventoryService.getInventory(req.params.id);
  return ok(res, inventory);
});

export const createInventory = asyncHandler(async (req: Request, res: Response) => {
  const input = createInventorySchema.parse(req.body);
  const inventory = await inventoryService.createInventory(input, req.user!.id);
  return ok(res, inventory, "Inventário criado com sucesso");
});

export const updateCount = asyncHandler(async (req: Request, res: Response) => {
  const { countedQty } = updateCountSchema.parse(req.body);
  const item = await inventoryService.updateCount(req.params.id, req.params.itemId, countedQty, req.user!.id);
  return ok(res, item, "Contagem registrada");
});

export const adjustItem = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = adjustItemSchema.parse({ ...req.body, inventoryItemId: req.params.itemId });
  const result = await inventoryService.adjustItem(req.params.id, req.params.itemId, reason, req.user!.id);
  return ok(res, result, "Estoque ajustado conforme inventário");
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = updateStatusSchema.parse(req.body);
  const inventory = await inventoryService.updateStatus(req.params.id, status, req.user!.id);
  return ok(res, inventory, "Status do inventário atualizado");
});
