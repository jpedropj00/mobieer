import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import * as controller from "./requisitions.controller";

const router = Router();
router.use(authenticate);
router.get("/indicators", requirePermission("requisitions.read"), controller.indicators);
router.get("/cutting-board", requirePermission("requisitions.cut"), controller.cuttingBoard);
router.get("/", requirePermission("requisitions.read"), controller.listRequisitions);
router.post("/", requirePermission("requisitions.create"), controller.createRequisition);
router.get("/:id", requirePermission("requisitions.read"), controller.getRequisition);
router.patch("/:id", requireAnyPermission(["requisitions.edit", "requisitions.edit.all"]), controller.updateRequisition);
router.patch("/:id/status", requireAnyPermission(["requisitions.create", "requisitions.analyze", "requisitions.release", "requisitions.cut", "requisitions.inspect", "requisitions.cancel"]), controller.updateStatus);
router.patch("/:id/items/:itemId/status", requireAnyPermission(["requisitions.cut", "requisitions.inspect"]), controller.updateItemStatus);
router.post("/:id/reservations", requirePermission("requisitions.reserve"), controller.reserve);
router.post("/:id/inspection", requirePermission("requisitions.inspect"), controller.inspect);

export default router;
