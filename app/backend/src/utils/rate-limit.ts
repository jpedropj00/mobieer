import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./ApiError";

/**
 * Limite simples por IP para rotas públicas (cadastro, login).
 *
 * Em memória: no Vercel cada instância tem o seu contador, então é uma
 * barreira contra abuso casual (script repetindo a mesma chamada), não uma
 * proteção forte. Para isso seria preciso um store compartilhado (Redis) —
 * `RateStore` existe para trocar a implementação sem mexer nas rotas.
 *
 * Janela fixa: simples de auditar e suficiente aqui. O burst na virada da
 * janela é aceitável para login e upload.
 */

export type RateHit = { count: number; resetAt: number };
export type RateStore = Map<string, RateHit>;
export type RateOptions = { windowMs: number; max: number; name: string };
export type RateResult = { allowed: boolean; remaining: number; retryAfterSec: number; resetAt: number };

/**
 * Registra uma tentativa e diz se ela passa. O `now` entra por parâmetro para
 * os testes não dependerem do relógio real.
 */
export function hitLimit(store: RateStore, key: string, opts: Pick<RateOptions, "windowMs" | "max">, now = Date.now()): RateResult {
  const atual = store.get(key);

  // Sem registro ou janela vencida: começa uma janela nova.
  if (!atual || atual.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, opts.max - 1), retryAfterSec: 0, resetAt };
  }

  atual.count++;
  const allowed = atual.count <= opts.max;
  return {
    allowed,
    remaining: Math.max(0, opts.max - atual.count),
    // arredonda para cima: faltando 200ms o cabeçalho diz 1s, nunca 0
    retryAfterSec: allowed ? 0 : Math.ceil((atual.resetAt - now) / 1000),
    resetAt: atual.resetAt,
  };
}

/** Descarta janelas vencidas: sem isto o mapa guarda todo IP que já passou. */
export function purgeExpired(store: RateStore, now = Date.now()): number {
  let removidos = 0;
  for (const [key, hit] of store) {
    if (hit.resetAt <= now) {
      store.delete(key);
      removidos++;
    }
  }
  return removidos;
}

/**
 * Quem está batendo. Com `trust proxy` ligado no app, `req.ip` já resolve o
 * X-Forwarded-For da Vercel — ler o cabeçalho na mão aceitaria um IP forjado
 * por qualquer cliente, então não se faz isso aqui.
 */
export function clientKey(req: Pick<Request, "ip"> & { socket?: { remoteAddress?: string } }, name: string): string {
  return `${name}:${req.ip || req.socket?.remoteAddress || "desconhecido"}`;
}

const PURGE_INTERVAL_MS = 60_000;

export function rateLimit(opts: RateOptions) {
  const store: RateStore = new Map();
  let ultimaLimpeza = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - ultimaLimpeza > PURGE_INTERVAL_MS) {
      purgeExpired(store, now);
      ultimaLimpeza = now;
    }

    const r = hitLimit(store, clientKey(req, opts.name), opts, now);
    res.setHeader("RateLimit-Limit", String(opts.max));
    res.setHeader("RateLimit-Remaining", String(r.remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((r.resetAt - now) / 1000)));

    if (r.allowed) return next();

    res.setHeader("Retry-After", String(r.retryAfterSec));
    return next(
      new ApiError(429, `Muitas tentativas. Tente de novo em ${Math.ceil(r.retryAfterSec / 60)} minuto(s).`, undefined, "RATE_LIMITED")
    );
  };
}

/**
 * Limites das rotas críticas (§61). Ficam juntos para dar para revisar os
 * números sem caçar pelo código.
 */
export const LIMITS = {
  /** Login: o alvo clássico de força bruta. */
  auth: { windowMs: 15 * 60_000, max: 20 },
  /** Recuperação de senha: enumera e-mail e ainda dispara envio. */
  passwordReset: { windowMs: 60 * 60_000, max: 10 },
  /** Cadastro público. */
  signup: { windowMs: 60 * 60_000, max: 10 },
  /** Upload: protege banda e disco, não credencial. */
  upload: { windowMs: 60_000, max: 60 },
} as const;
