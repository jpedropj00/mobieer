import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./ApiError";

/**
 * Limite simples por IP para rotas públicas (cadastro, login).
 *
 * Em memória: no Vercel cada instância tem o seu contador, então é uma
 * barreira contra abuso casual (script repetindo a mesma chamada), não uma
 * proteção forte. Para isso seria preciso um store compartilhado (Redis).
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.ip || "desconhecido";
    const key = `${opts.name}:${ip}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return next();
    }
    entry.count++;
    if (entry.count > opts.max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return next(new ApiError(429, `Muitas tentativas. Tente de novo em ${Math.ceil(retry / 60)} minuto(s).`, undefined, "RATE_LIMITED"));
    }
    next();
  };
}
