import type { Request, Response } from "express";
import { MovementType } from "@prisma/client";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { BadRequestError } from "../../utils/ApiError";
import * as reportsService from "./reports.service";
import { exportQuery, reportQuery, reportType } from "./reports.schema";
import { exportPdf, exportXlsx } from "./reports.export";

export const runReport = asyncHandler(async (req: Request, res: Response) => {
  const type = reportType.parse(req.params.type);
  const filters = reportQuery.parse(req.query);
  const data = await reportsService.runReport(type, filters);
  return ok(res, data);
});

export const productHistory = asyncHandler(async (req: Request, res: Response) => {
  const data = await reportsService.getProductHistory(req.params.id);
  return ok(res, data);
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const type = reportType.parse(req.params.type);
  const { format } = exportQuery.parse(req.query);
  const filters = reportQuery.parse(req.query);
  const data = await reportsService.runReport(type, filters);

  const filename = `relatorio-${type}-${new Date().toISOString().slice(0, 10)}`;

  if (format === "xlsx") return exportXlsx(res, data, filename);
  if (format === "pdf") return exportPdf(res, data, filename, type);
  throw new BadRequestError("Formato de exportação inválido");
});
