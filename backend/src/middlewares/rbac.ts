import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../utils/ApiError";

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ForbiddenError("Não autenticado"));
    if (!req.user.permissions.includes(permission)) {
      return next(new ForbiddenError(`Permissão necessária: ${permission}`));
    }
    next();
  };
}

export function requireAnyPermission(permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ForbiddenError("Não autenticado"));
    if (!permissions.some((p) => req.user!.permissions.includes(p))) {
      return next(new ForbiddenError("Sem permissão para esta ação"));
    }
    next();
  };
}
