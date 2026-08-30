import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import * as authController from "./auth.controller";

const router = Router();

router.post("/login", authController.login);
router.post("/register-enterprise", authController.registerEnterprise);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

router.use(authenticate);
router.get("/me", authController.me);
router.post("/logout", authController.logout);
router.post("/change-password", authController.changePassword);

export default router;
