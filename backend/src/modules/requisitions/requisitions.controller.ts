import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as requisitionsService from "./requisitions.service";
import { createRequisitionSchema, requisitionsQuery, updateStatusSchema } from "./requisitions.schema";

export const listRequisitions = asyncHandler(async (req: Request, res: Response) => {
  const q = requisitionsQuery.parse(req.query);
  const result = await requisitionsService.listRequisitions({
    page: q.page,
    perPage: q.perPage,
    status: q.status,
    search: q.search,
    userId: q.my === "true" ? req.user!.id : undefined,
  });
  return res.json({ success: true, data: result.items, meta: result.meta });
});

export const getRequisition = asyncHandler(async (req: Request, res: Response) => {
  const requisition = await requisitionsService.getRequisition(req.params.id);
  return ok(res, requisition);
});

export const createRequisition = asyncHandler(async (req: Request, res: Response) => {
  const input = createRequisitionSchema.parse(req.body);
  const requisition = await requisitionsService.createRequisition(input, req.user!.id, req.user!.name);
  return ok(res, requisition, "Requisição criada com sucesso");
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, note } = updateStatusSchema.parse(req.body);
  const allowNegative = req.user!.permissions.includes("stock.negative");
  const requisition = await requisitionsService.updateRequisitionStatus(
    req.params.id,
    status,
    note ?? null,
    req.user!.id,
    req.user!.name,
    allowNegative
  );
  return ok(res, requisition, "Status da requisição atualizado");
});
