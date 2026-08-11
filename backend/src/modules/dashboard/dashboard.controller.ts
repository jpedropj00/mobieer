import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as dashboardService from "./dashboard.service";
import { chartQuery } from "./dashboard.schema";

export const dashboard = asyncHandler(async (_req: Request, res: Response) => {
  const data = await dashboardService.getDashboard();
  return ok(res, data);
});

export const chart = asyncHandler(async (req: Request, res: Response) => {
  const { period } = chartQuery.parse(req.query);
  const data = await dashboardService.getChart(period);
  return ok(res, data);
});
