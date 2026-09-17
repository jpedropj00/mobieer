import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  DatabaseUnavailableError,
  InvalidQueryError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
} from "../utils/ApiError";

/** Códigos do Prisma que significam "não consegui falar com o banco". */
const PRISMA_UNAVAILABLE = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: "Arquivo maior que o tamanho permitido",
  LIMIT_FILE_COUNT: "Arquivos demais no mesmo envio",
  LIMIT_UNEXPECTED_FILE: "Campo de arquivo inesperado no envio",
  LIMIT_PART_COUNT: "Formulário com partes demais",
  LIMIT_FIELD_KEY: "Nome de campo longo demais",
  LIMIT_FIELD_VALUE: "Valor de campo longo demais",
  LIMIT_FIELD_COUNT: "Campos demais no formulário",
};

type HttpLikeError = Error & { status?: number; statusCode?: number; type?: string; expose?: boolean };

/**
 * Converte qualquer erro lançado em um `ApiError` com status e código certos.
 * Retorna `null` quando o erro é desconhecido (bug) — o chamador responde 500.
 */
export function normalizeError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ValidationError("Dados inválidos", err.flatten());
  }

  if (err instanceof multer.MulterError) {
    const message = MULTER_MESSAGES[err.code] ?? "Falha no envio do arquivo";
    if (err.code === "LIMIT_FILE_SIZE") return new PayloadTooLargeError(message, { field: err.field }, "FILE_TOO_LARGE");
    return new BadRequestError(message, { field: err.field, reason: err.code }, "UPLOAD_ERROR");
  }

  // body-parser (express.json / urlencoded)
  const httpErr = err as HttpLikeError;
  if (httpErr?.type === "entity.parse.failed") {
    return new BadRequestError("Corpo da requisição não é um JSON válido", undefined, "INVALID_JSON");
  }
  if (httpErr?.type === "entity.too.large") {
    return new PayloadTooLargeError("Conteúdo da requisição maior que o permitido");
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (err.meta ?? {}) as { target?: string[] | string; field_name?: string; column_name?: string };
    if (PRISMA_UNAVAILABLE.has(err.code)) return new DatabaseUnavailableError();
    switch (err.code) {
      case "P2002": {
        const target = Array.isArray(meta.target) ? meta.target.join(", ") : meta.target ?? "";
        return new ConflictError(`Registro duplicado${target ? `: ${target}` : ""}`, { target: meta.target }, "DUPLICATE");
      }
      case "P2003":
        return new ConflictError(
          "Operação bloqueada: o registro está vinculado a outro(s) registro(s)",
          { field: meta.field_name },
          "REFERENCE_CONFLICT"
        );
      case "P2025":
      case "P2001":
        return new NotFoundError("Registro não encontrado");
      case "P2000":
        return new ValidationError("Valor maior que o permitido para o campo", { column: meta.column_name });
      case "P2006":
      case "P2007":
      case "P2009":
      case "P2012":
      case "P2013":
        return new ValidationError("Dados inválidos para gravação");
      default:
        return null;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    // Normalmente um filtro vindo da URL que não bate com o schema (enum ou data inválida).
    return new InvalidQueryError("Parâmetro inválido na consulta");
  }

  if (err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientRustPanicError) {
    return new DatabaseUnavailableError();
  }

  if (httpErr?.name === "TokenExpiredError" || httpErr?.name === "JsonWebTokenError" || httpErr?.name === "NotBeforeError") {
    return new UnauthorizedError("Sessão expirada ou inválida");
  }

  // Erros HTTP de bibliotecas (http-errors) com status 4xx e mensagem segura para expor.
  const status = httpErr?.status ?? httpErr?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && httpErr.expose) {
    return new ApiError(status, httpErr.message);
  }

  return null;
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // Resposta já começou (ex.: download em streaming): só dá para encerrar a conexão.
  if (res.headersSent) return next(err);

  const apiErr = normalizeError(err);
  if (apiErr) {
    if (apiErr.isServerError) {
      console.error(`[${apiErr.code}] ${req?.method ?? ""} ${req?.originalUrl ?? ""}:`, err);
    }
    return res.status(apiErr.statusCode).json({
      success: false,
      code: apiErr.code,
      message: apiErr.message,
      // Detalhes de falhas 5xx (resposta de provedor, etc.) ficam só no log.
      details: apiErr.isServerError ? undefined : apiErr.details,
    });
  }

  // Desconhecido = bug. Não expõe a mensagem interna; devolve um id para achar no log.
  const errorId = crypto.randomBytes(6).toString("hex");
  console.error(`[INTERNAL_ERROR ${errorId}] ${req?.method ?? ""} ${req?.originalUrl ?? ""}:`, err);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Erro interno do servidor",
    errorId,
  });
}

export function notFound(_req: Request, res: Response) {
  return res.status(404).json({ success: false, code: "ROUTE_NOT_FOUND", message: "Rota não encontrada" });
}
