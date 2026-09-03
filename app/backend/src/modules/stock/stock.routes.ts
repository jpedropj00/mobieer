import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import * as stockController from "./stock.controller";

const router = Router();

router.use(authenticate);

router.get("/movements", requirePermission("stock.movements"), stockController.listMovements);
router.get("/alerts", requirePermission("stock.read"), stockController.listAlerts);
router.get("/summary", requirePermission("stock.read"), stockController.stockSummary);

router.post("/entries", requirePermission("stock.entry"), stockController.createEntry);
router.post("/exits", requirePermission("stock.exit"), stockController.createExit);
router.post("/adjust", requirePermission("stock.adjust"), stockController.adjustStock);

export default router;
