import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { agendaQuery, eventInput, moveInput, statusInput, typeInput } from "./agenda.schema";
import * as service from "./agenda.service";

export const list = asyncHandler(async (req: Request, res: Response) => ok(res, await service.list(agendaQuery.parse(req.query), req.user!)));
export const get = asyncHandler(async (req: Request, res: Response) => ok(res, await service.get(req.params.id, req.user!)));
export const create = asyncHandler(async (req: Request, res: Response) => ok(res, await service.create(eventInput.parse(req.body), req.user!), "Compromisso criado"));
export const update = asyncHandler(async (req: Request, res: Response) => ok(res, await service.update(req.params.id, eventInput.parse(req.body), req.user!), "Compromisso atualizado"));
export const move = asyncHandler(async (req: Request, res: Response) => { const data = moveInput.parse(req.body); return ok(res, await service.move(req.params.id, data.startAt, data.endAt, data.forceConflict, req.user!), "Compromisso reagendado"); });
export const changeStatus = asyncHandler(async (req: Request, res: Response) => ok(res, await service.changeStatus(req.params.id, statusInput.parse(req.body).status, req.user!), "Status atualizado"));
export const types = asyncHandler(async (req: Request, res: Response) => ok(res, await service.types(req.user!.organizationId)));
export const createType = asyncHandler(async (req: Request, res: Response) => ok(res, await service.createType(typeInput.parse(req.body), req.user!), "Tipo criado"));
export const metrics = asyncHandler(async (req: Request, res: Response) => ok(res, await service.metrics(req.user!)));
export const employees = asyncHandler(async (req: Request, res: Response) => ok(res, await service.employees(req.user!)));
export const upload = asyncHandler(async (req: Request, res: Response) => { if (!req.file) return res.status(400).json({ success:false, message:"Selecione um arquivo" }); const baseUrl=`${req.protocol}://${req.get("host")}`; return ok(res,{name:req.file.originalname,url:`${baseUrl}/uploads/${req.file.filename}`,mimeType:req.file.mimetype,size:req.file.size}); });
