import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";

const DEFAULT_SETTINGS = {
  companyName: "MOBIEER",
  companyDocument: "",
  lowStockAlertDays: "0",
  notificationsEnabled: "true",
};

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await prisma.setting.findMany();
    const map: Record<string, string> = { ...DEFAULT_SETTINGS };
    settings.forEach((s) => (map[s.key] = s.value));
    return ok(res, map);
  })
);

router.put(
  "/",
  requirePermission("settings.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as Record<string, string>;
    const allowed = Object.keys(DEFAULT_SETTINGS);
    const entries = Object.entries(body).filter(([k]) => allowed.includes(k));

    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }

    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "SETTINGS_UPDATED", entity: "Setting", details: { keys: entries.map(([k]) => k) } },
    });

    const settings = await prisma.setting.findMany();
    const map: Record<string, string> = { ...DEFAULT_SETTINGS };
    settings.forEach((s) => (map[s.key] = s.value));
    return ok(res, map, "Configurações salvas");
  })
);

export default router;
