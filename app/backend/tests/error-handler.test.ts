import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { errorHandler } from "../src/middlewares/errorHandler";
import { BadRequestError, NotFoundError } from "../src/utils/ApiError";

/** Executa o errorHandler com uma resposta falsa e devolve status + corpo. */
function run(err: unknown) {
  const out: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    headersSent: false,
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  } as unknown as Response;
  const silence = console.error;
  console.error = () => undefined;
  try {
    errorHandler(err, {} as Request, res, () => undefined);
  } finally {
    console.error = silence;
  }
  return out;
}

const prismaKnown = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("erro prisma", { code, clientVersion: "test", meta });

test("erros de domínio mantêm status e mensagem", () => {
  const r = run(new NotFoundError("Medição não encontrada"));
  assert.equal(r.status, 404);
  assert.equal(r.body.message, "Medição não encontrada");
  assert.equal(r.body.code, "NOT_FOUND");
});

test("ZodError vira 400 VALIDATION_ERROR", () => {
  const parsed = z.object({ n: z.number() }).safeParse({ n: "x" });
  assert.equal(parsed.success, false);
  const r = run((parsed as { error: unknown }).error);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "VALIDATION_ERROR");
});

test("arquivo acima do limite do multer vira 413, não 500", () => {
  const r = run(new multer.MulterError("LIMIT_FILE_SIZE", "file"));
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "FILE_TOO_LARGE");
});

test("JSON malformado no corpo vira 400, não 500", () => {
  const err = Object.assign(new SyntaxError("Unexpected token } in JSON"), { status: 400, type: "entity.parse.failed" });
  const r = run(err);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_JSON");
});

test("corpo grande demais vira 413", () => {
  const err = Object.assign(new Error("request entity too large"), { status: 413, type: "entity.too.large" });
  const r = run(err);
  assert.equal(r.status, 413);
});

test("filtro inválido que chega ao Prisma (enum/data) vira 400, não 500", () => {
  const err = new Prisma.PrismaClientValidationError("Invalid value for argument `status`", { clientVersion: "test" });
  const r = run(err);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "INVALID_QUERY");
});

test("banco fora do ar (P1001) vira 503 com mensagem clara", () => {
  const r = run(prismaKnown("P1001"));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "DATABASE_UNAVAILABLE");
});

test("pool de conexões esgotado (P2024) vira 503", () => {
  const r = run(prismaKnown("P2024"));
  assert.equal(r.status, 503);
});

test("falha de inicialização do Prisma vira 503", () => {
  const r = run(new Prisma.PrismaClientInitializationError("Can't reach database server", "test"));
  assert.equal(r.status, 503);
});

test("chave estrangeira violada (P2003) vira 409, não 500", () => {
  const r = run(prismaKnown("P2003", { field_name: "clientId" }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "REFERENCE_CONFLICT");
});

test("registro duplicado (P2002) segue 409", () => {
  const r = run(prismaKnown("P2002", { target: ["organizationId", "code"] }));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "DUPLICATE");
});

test("valor longo demais para a coluna (P2000) vira 400", () => {
  const r = run(prismaKnown("P2000"));
  assert.equal(r.status, 400);
});

test("erro desconhecido vira 500 genérico sem vazar detalhes internos", () => {
  const r = run(new Error("connection string postgres://user:senha@host"));
  assert.equal(r.status, 500);
  assert.equal(r.body.code, "INTERNAL_ERROR");
  assert.ok(!String(r.body.message).includes("senha"));
  assert.match(String(r.body.errorId), /^[a-z0-9]{8,}$/);
});

test("BadRequestError preserva details", () => {
  const r = run(new BadRequestError("Campo inválido", { field: "cpf" }));
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.details, { field: "cpf" });
});
