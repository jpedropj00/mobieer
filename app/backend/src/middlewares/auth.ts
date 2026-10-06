import { effectivePermissions, roleNames, rolesInclude, rolesLabel } from "../lib/user-roles";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../prisma";
import { ApiError, UnauthorizedError } from "../utils/ApiError";
import { accessAllowedAny, passwordExpired } from "../lib/security-policy";
import { loadSecurityPolicy } from "../lib/security";

/** Com troca de senha pendente, só estas rotas respondem (a tela de troca usa). */
const PASSWORD_CHANGE_ALLOWED = ["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"];

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
        ...rolesInclude,
      },
    });

    if (!user || user.status !== "ACTIVE" || user.organization.enterprise.status !== "ACTIVE") {
      throw new UnauthorizedError("Usuário inativo ou não encontrado");
    }
    if (user.lockedAt) throw new UnauthorizedError("Usuário bloqueado. Fale com o administrador.");

    // IP e horário valem para a sessão inteira, não só na entrada
    const policy = await loadSecurityPolicy();
    const access = accessAllowedAny(policy, { roles: roleNames(user), ip: req.ip });
    if (!access.ok) throw new ApiError(403, access.message, undefined, "ACCESS_RESTRICTED");
    const path = req.originalUrl.split("?")[0];
    if ((user.mustChangePassword || passwordExpired(user.passwordChangedAt, policy)) && !PASSWORD_CHANGE_ALLOWED.includes(path)) {
      throw new ApiError(403, "Troque a sua senha para continuar.", undefined, "PASSWORD_CHANGE_REQUIRED");
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
      roles: roleNames(user),
      roleLabel: rolesLabel(user),
      organizationId: user.organizationId,
      enterpriseId: user.organization.enterpriseId,
      sector: user.sector,
      // soma das permissões de todos os cargos da pessoa
      permissions: effectivePermissions(user),
    };

    next();
  } catch (error) {
    next(error);
  }
}
