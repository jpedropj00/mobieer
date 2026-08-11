import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Dados inválidos",
      details: err.flatten(),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  // Prisma known errors
  const prismaErr = err as { code?: string; meta?: { target?: string[] }; message?: string };
  if (prismaErr?.code === "P2002") {
    return res.status(409).json({
      success: false,
      message: `Registro duplicado: ${(prismaErr.meta?.target ?? []).join(", ")}`,
    });
  }
  if (prismaErr?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Registro não encontrado" });
  }

  console.error("[ERROR]", err);
  return res.status(500).json({
    success: false,
    message: "Erro interno do servidor",
  });
}

export function notFound(_req: Request, res: Response) {
  return res.status(404).json({ success: false, message: "Rota não encontrada" });
}
