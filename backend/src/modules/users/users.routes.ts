import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import * as usersController from "./users.controller";

const router = Router();

router.use(authenticate);

router.get("/permissions", requirePermission("users.read"), usersController.listPermissions);
router.get("/roles", requirePermission("users.read"), usersController.listRoles);
router.put("/roles/:roleId/permissions", requirePermission("users.manage"), usersController.updateRolePermissions);

router.get("/", requirePermission("users.read"), usersController.listUsers);
router.get("/:id", requirePermission("users.read"), usersController.getUser);
router.post("/", requirePermission("users.manage"), usersController.createUser);
router.put("/:id", requirePermission("users.manage"), usersController.updateUser);
router.patch("/:id/status", requirePermission("users.manage"), usersController.updateUserStatus);
router.delete("/:id", requirePermission("users.manage"), usersController.deleteUser);

export default router;
