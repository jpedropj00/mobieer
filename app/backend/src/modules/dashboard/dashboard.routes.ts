import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import * as dashboardController from "./dashboard.controller";
import { z } from "zod";
import { requireAnyPermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { operationDashboard } from "./operation.service";
import { PERIODS } from "./operation.rules";

const router = Router();

router.use(authenticate);

router.get("/", dashboardController.dashboard);
router.get("/chart", dashboardController.chart);

// GET /api/dashboard/operation?period=today|7d|month|year — painel da "sala de controle"
router.get(
  "/operation",
  requireAnyPermission(["dashboard.read", "reports.read", "commercial.read.all"]),
  asyncHandler(async (req, res) => {
    const period = z.enum(PERIODS as [string, ...string[]]).default("month").parse(req.query.period || undefined) as (typeof PERIODS)[number];
    return ok(res, await operationDashboard(req.user!.organizationId, period));
  })
);

export default router;
