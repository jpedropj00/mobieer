import crypto from "crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { runDailyJobs } from "../../jobs/daily";
import { asyncHandler } from "../../utils/asyncHandler";
import { ServiceUnavailableError, UnauthorizedError } from "../../utils/ApiError";

/**
 * GET /api/cron/daily — disparado pelo Vercel Cron (ver vercel.json).
 * O Vercel manda `Authorization: Bearer <CRON_SECRET>` automaticamente quando a
 * variável CRON_SECRET existe no projeto.
 */
const router = Router();

export function cronAuthorized(header: string | undefined, secret: string, isProduction: boolean) {
  if (!secret) return !isProduction; // em dev sem segredo, libera; em produção, nunca
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

router.get(
  "/daily",
  asyncHandler(async (req, res) => {
    if (!env.cron.secret && env.isProduction) {
      throw new ServiceUnavailableError("CRON_SECRET não configurado no servidor");
    }
    if (!cronAuthorized(req.header("authorization"), env.cron.secret, env.isProduction)) {
      throw new UnauthorizedError("Cron não autorizado");
    }
    const started = Date.now();
    const results = await runDailyJobs();
    return res.json({ success: results.every((r) => r.ok), ms: Date.now() - started, results });
  })
);

export default router;
