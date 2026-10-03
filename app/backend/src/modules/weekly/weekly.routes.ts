/**
 * Semana da Mobieer: /api/weekly
 *
 *   GET /?week=aaaa-mm-dd   planejamento da semana (segunda-feira; padrão: esta semana)
 *   GET /notes?week=        checklist marcado e anotações da pessoa
 *   PUT /notes              salva checklist e anotações
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { mondayOf } from "./weekly.rules";
import { weeklyFor } from "./weekly.service";

const router = Router();
router.use(authenticate);

const weekOf = (v: unknown) => {
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  return s ? mondayOf(new Date(`${s}T15:00:00Z`)) : mondayOf(new Date());
};
const notesKey = (userId: string, week: string) => `weekly.${userId}.${week}`;

router.get(
  "/",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => ok(res, await weeklyFor(req.user!.organizationId, weekOf(req.query.week))))
);

router.get(
  "/notes",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const row = await prisma.setting.findUnique({ where: { key: notesKey(req.user!.id, weekOf(req.query.week)) } });
    let value = { checked: [] as string[], notes: "" };
    try {
      if (row) value = { ...value, ...JSON.parse(row.value) };
    } catch {
      /* valor antigo inválido: começa vazio */
    }
    return ok(res, value);
  })
);

router.put(
  "/notes",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const input = z.object({ week: z.string(), checked: z.array(z.string().max(80)).max(500), notes: z.string().max(10_000) }).parse(req.body);
    const key = notesKey(req.user!.id, weekOf(input.week));
    const value = JSON.stringify({ checked: input.checked, notes: input.notes });
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return ok(res, { saved: true });
  })
);

export default router;
