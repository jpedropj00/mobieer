import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { ForbiddenError } from "../../utils/ApiError";
import { createRequisitionSchema, inspectionSchema, requisitionsQuery, reservationSchema, updateItemStatusSchema, updateRequisitionSchema, updateStatusSchema } from "./requisitions.schema";
import * as service from "./requisitions.service";

export const listRequisitions = asyncHandler(async (req: Request, res: Response) => {
  const q = requisitionsQuery.parse(req.query);
  const onlyOwn = q.my === "true" || !req.user!.permissions.includes("requisitions.read.all");
  const result = await service.listRequisitions({ ...q, overdue: q.overdue === "true", userId: onlyOwn ? req.user!.id : undefined });
  res.json({ success: true, data: result.items, meta: result.meta });
});
export const indicators = asyncHandler(async (req: Request, res: Response) => ok(res, await service.getIndicators(req.user!.permissions.includes("requisitions.read.all") ? undefined : req.user!.id)));
export const cuttingBoard = asyncHandler(async (_req: Request, res: Response) => ok(res, await service.listCuttingBoard()));
export const getRequisition = asyncHandler(async (req: Request, res: Response) => { const requisition = await service.getRequisition(req.params.id); if (!req.user!.permissions.includes("requisitions.read.all") && requisition.requester.id !== req.user!.id) throw new ForbiddenError("Você não pode acessar esta requisição"); return ok(res, requisition); });
export const createRequisition = asyncHandler(async (req: Request, res: Response) => ok(res, await service.createRequisition(createRequisitionSchema.parse(req.body), req.user!.id), "Requisição criada"));
export const updateRequisition = asyncHandler(async (req: Request, res: Response) => ok(res, await service.updateRequisition(req.params.id, updateRequisitionSchema.parse(req.body), req.user!.id, req.user!.permissions), "Requisição atualizada"));
export const updateStatus = asyncHandler(async (req: Request, res: Response) => { const input = updateStatusSchema.parse(req.body); return ok(res, await service.updateRequisitionStatus(req.params.id, input.status, input.note ?? null, req.user!.id, req.user!.permissions, input.responsibleId), "Status atualizado"); });
export const updateItemStatus = asyncHandler(async (req: Request, res: Response) => { const input = updateItemStatusSchema.parse(req.body); return ok(res, await service.updateItemStatus(req.params.id, req.params.itemId, input.status, req.user!.id, input.note), "Peça atualizada"); });
export const inspect = asyncHandler(async (req: Request, res: Response) => { const input = inspectionSchema.parse(req.body); return ok(res, await service.inspectRequisition(req.params.id, input.result, input.note ?? null, req.user!.id), "Conferência registrada"); });
export const reserve = asyncHandler(async (req: Request, res: Response) => ok(res, await service.reserveMaterials(req.params.id, reservationSchema.parse(req.body), req.user!.id), "Materiais reservados"));
