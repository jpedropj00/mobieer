/**
 * Tokens de integração (máquina a máquina), por organização.
 *
 * Formato: `mbx_<43 caracteres>`. No banco fica só o SHA-256; o token puro
 * aparece uma única vez, na criação. Escopos limitam o que cada token faz.
 */
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../prisma";
import { ForbiddenError, UnauthorizedError } from "../../utils/ApiError";

export const INTEGRATION_SCOPES = {
  "promob.import": "Enviar arquivos exportados do Promob para os projetos",
} as const;
export type IntegrationScope = keyof typeof INTEGRATION_SCOPES;

export const TOKEN_PREFIX = "mbx_";

export function generateIntegrationToken() {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Lê o token do cabeçalho X-Mobieer-Token ou Authorization: Bearer. */
export function tokenFromHeaders(headers: { authorization?: string; "x-mobieer-token"?: string | string[] }) {
  const custom = headers["x-mobieer-token"];
  const raw = Array.isArray(custom) ? custom[0] : custom;
  if (raw?.startsWith(TOKEN_PREFIX)) return raw.trim();
  const auth = headers.authorization;
  if (auth?.startsWith(`Bearer ${TOKEN_PREFIX}`)) return auth.slice(7).trim();
  return null;
}

export type IntegrationContext = { tokenId: string; organizationId: string; name: string };

declare module "express-serve-static-core" {
  interface Request {
    integration?: IntegrationContext;
  }
}

/** Não regrava lastUsedAt a cada chamada (o sincronizador pode ser frequente). */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export function authenticateIntegration(scope: IntegrationScope) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = tokenFromHeaders(req.headers as Parameters<typeof tokenFromHeaders>[0]);
      if (!token) throw new UnauthorizedError("Token de integração não informado (cabeçalho X-Mobieer-Token)");
      const row = await prisma.integrationToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row || row.revokedAt) throw new UnauthorizedError("Token de integração inválido ou revogado");
      if (!row.scopes.includes(scope)) throw new ForbiddenError(`Este token não tem permissão para ${scope}`);
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
        await prisma.integrationToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
      }
      req.integration = { tokenId: row.id, organizationId: row.organizationId, name: row.name };
      next();
    } catch (e) {
      next(e);
    }
  };
}
