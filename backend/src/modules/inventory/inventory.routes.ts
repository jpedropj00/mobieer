import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import * as inventoryController from "./inventory.controller";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("inventory.read"), inventoryController.listInventories);
router.post("/", requirePermission("inventory.create"), inventoryController.createInventory);
router.get("/:id", requirePermission("inventory.read"), inventoryController.getInventory);
router.patch("/:id/items/:itemId/count", requirePermission("inventory.update"), inventoryController.updateCount);
router.post("/:id/items/:itemId/adjust", requirePermission("inventory.adjust"), inventoryController.adjustItem);
router.patch("/:id/status", requirePermission("inventory.update"), inventoryController.updateStatus);

export default router;
