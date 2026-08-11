import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import * as dashboardController from "./dashboard.controller";

const router = Router();

router.use(authenticate);

router.get("/", dashboardController.dashboard);
router.get("/chart", dashboardController.chart);

export default router;
