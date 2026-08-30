import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import * as reportsController from "./reports.controller";

const router = Router();

router.use(authenticate);

router.get("/product/:id/history", requirePermission("reports.read"), reportsController.productHistory);
router.get("/export/:type", requirePermission("reports.export"), reportsController.download);
router.get("/:type", requirePermission("reports.read"), reportsController.runReport);

export default router;
