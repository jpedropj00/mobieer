import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { LIMITS, rateLimit } from "../../utils/rate-limit";
import * as authController from "./auth.controller";

const router = Router();

// Rotas sem sessão: é onde a força bruta bate. O limite vem antes do controller
// para a tentativa barrada nem chegar ao banco.
router.post("/login", rateLimit({ name: "auth-login", ...LIMITS.auth }), authController.login);
router.post("/register-enterprise", rateLimit({ name: "auth-register", ...LIMITS.signup }), authController.registerEnterprise);
router.post("/forgot-password", rateLimit({ name: "auth-forgot", ...LIMITS.passwordReset }), authController.forgotPassword);
router.post("/reset-password", rateLimit({ name: "auth-reset", ...LIMITS.passwordReset }), authController.resetPassword);

router.use(authenticate);
router.get("/me", authController.me);
router.post("/logout", authController.logout);
router.post("/change-password", authController.changePassword);

export default router;
