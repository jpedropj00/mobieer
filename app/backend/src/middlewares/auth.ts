import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { UnauthorizedError } from "../utils/ApiError";

type JwtPayload = { sub: string };

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Token de acesso não informado");
    }

    const token = header.slice(7);
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    } catch {
      throw new UnauthorizedError("Sessão expirada ou inválida");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        organization: { include: { enterprise: true } },
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });

    if (!user || user.status !== "ACTIVE" || user.organization.enterprise.status !== "ACTIVE") {
      throw new UnauthorizedError("Usuário inativo ou não encontrado");
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
      roleLabel: user.role.label,
      organizationId: user.organizationId,
      enterpriseId: user.organization.enterpriseId,
      sector: user.sector,
      permissions: user.role.permissions.map((rp) => rp.permission.code),
    };

    next();
  } catch (error) {
    next(error);
  }
}
