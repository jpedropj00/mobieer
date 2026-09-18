import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { ClientAccessLevel } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { ForbiddenError, UnauthorizedError } from "../utils/ApiError";

const PORTAL_AUDIENCE = "mobieer-client";

type PortalJwtPayload = { sub: string };

/**
 * O token só identifica a conta. Nível de acesso e cliente vêm sempre do banco:
 * quando a equipe completa o cadastro, o acesso amplia sem precisar novo login.
 */
export function signPortalToken(accountId: string) {
  return jwt.sign({ sub: accountId }, env.portal.jwtSecret, {
    audience: PORTAL_AUDIENCE,
    expiresIn: env.portal.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export type PortalAccountContext = {
  accountId: string;
  level: ClientAccessLevel;
  clientId: string | null;
  leadId: string | null;
  name: string;
  email: string;
};

declare module "express-serve-static-core" {
  interface Request {
    portalAccount?: PortalAccountContext;
  }
}

async function resolveAccount(req: Request): Promise<PortalAccountContext> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) throw new UnauthorizedError("Token de acesso não informado");

  let payload: PortalJwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.portal.jwtSecret, { audience: PORTAL_AUDIENCE }) as PortalJwtPayload;
  } catch {
    throw new UnauthorizedError("Sessão expirada ou inválida");
  }

  const account = await prisma.clientAccount.findUnique({
    where: { id: payload.sub },
    include: { client: { select: { id: true, status: true } } },
  });
  if (!account || account.status !== "ACTIVE") throw new UnauthorizedError("Acesso inválido ou desativado");
  if (account.client && account.client.status !== "ACTIVE") throw new UnauthorizedError("Cadastro do cliente inativo");

  return {
    accountId: account.id,
    level: account.accessLevel,
    clientId: account.clientId,
    leadId: account.leadId,
    name: account.name,
    email: account.email,
  };
}

/** Qualquer conta ativa do portal (inclusive quem só tem acesso ao briefing). */
export async function authenticatePortalAccount(req: Request, _res: Response, next: NextFunction) {
  try {
    req.portalAccount = await resolveAccount(req);
    next();
  } catch (error) {
    next(error);
  }
}

/** Cliente com cadastro completo: portal inteiro. */
export async function authenticateClient(req: Request, _res: Response, next: NextFunction) {
  try {
    const ctx = await resolveAccount(req);
    if (ctx.level !== "FULL" || !ctx.clientId) {
      throw new ForbiddenError("Seu acesso ainda é só ao briefing. Assim que a equipe completar seu cadastro, o portal completo é liberado.");
    }
    req.portalAccount = ctx;
    req.portal = { accountId: ctx.accountId, clientId: ctx.clientId, name: ctx.name, email: ctx.email };
    next();
  } catch (error) {
    next(error);
  }
}
