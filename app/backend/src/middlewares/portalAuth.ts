import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { UnauthorizedError } from "../utils/ApiError";

const PORTAL_AUDIENCE = "mobieer-client";

type PortalJwtPayload = { sub: string; cid: string };

export function signPortalToken(accountId: string, clientId: string) {
  return jwt.sign({ sub: accountId, cid: clientId }, env.portal.jwtSecret, {
    audience: PORTAL_AUDIENCE,
    expiresIn: env.portal.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export async function authenticateClient(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Token de acesso não informado");
    }

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

    if (!account || account.status !== "ACTIVE" || account.client.id !== payload.cid) {
      throw new UnauthorizedError("Acesso inválido ou desativado");
    }
    if (account.client.status !== "ACTIVE") {
      throw new UnauthorizedError("Cadastro do cliente inativo");
    }

    req.portal = {
      accountId: account.id,
      clientId: account.clientId,
      name: account.name,
      email: account.email,
    };
    next();
  } catch (error) {
    next(error);
  }
}
