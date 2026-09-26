import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";
import { z } from "zod";
import { BadRequestError } from "../../utils/ApiError";
import { cleanIp, normalizePolicy, validIpRule } from "../../lib/security-policy";
import { loadSecurityPolicy, saveSecurityPolicy } from "../../lib/security";

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

// GET /api/settings/security — política de senha e restrições de acesso
router.get(
  "/security",
  requirePermission("settings.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const roles = await prisma.role.findMany({ select: { name: true, label: true }, orderBy: { label: "asc" } });
    return ok(res, { policy: await loadSecurityPolicy(), yourIp: cleanIp(req.ip), roles });
  })
);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário no formato HH:MM");

// PUT /api/settings/security
router.put(
  "/security",
  requirePermission("settings.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const input = z
      .object({
        minLength: z.coerce.number().int().min(6).max(64),
        requireUpper: z.boolean(),
        requireLower: z.boolean(),
        requireDigit: z.boolean(),
        requireSymbol: z.boolean(),
        expiryDays: z.coerce.number().int().min(0).max(365),
        maxAttempts: z.coerce.number().int().min(0).max(20),
        allowedIps: z.array(z.string().trim().min(1).max(50)).max(50),
        ipExemptRoles: z.array(z.string().max(40)).max(30),
        schedules: z
          .array(z.object({ role: z.string().min(1).max(40), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), start: hhmm, end: hhmm }))
          .max(60),
      })
      .parse(req.body);
    const bad = input.allowedIps.filter((r) => !validIpRule(r));
    if (bad.length) throw new BadRequestError(`IP ou faixa inválida: ${bad.join(", ")}`);
    if (input.schedules.some((w) => w.role === "ADMIN")) throw new BadRequestError("O administrador não tem restrição de horário (é quem conserta a regra)");
    const policy = normalizePolicy(input);
    await saveSecurityPolicy(policy);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "SECURITY_POLICY_UPDATED", entity: "Setting", entityId: "security.policy", details: input } });
    return ok(res, { policy, yourIp: cleanIp(req.ip) }, "Política de segurança salva");
  })
);

export default router;
