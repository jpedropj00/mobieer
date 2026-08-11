import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import * as requisitionsController from "./requisitions.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("requisitions.read"), requisitionsController.listRequisitions);
router.post("/", requirePermission("requisitions.create"), requisitionsController.createRequisition);
router.get("/:id", requirePermission("requisitions.read"), requisitionsController.getRequisition);
router.patch(
  "/:id/status",
  requireAnyPermission(["requisitions.approve", "requisitions.separate", "requisitions.finish", "requisitions.cancel"]),
  requisitionsController.updateStatus
);

export default router;
