import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import type { Response } from "express";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  DatabaseUnavailableError,
  ExternalServiceError,
  ForbiddenError,
  InvalidQueryError,
  InvalidStateError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  StorageError,
  UnauthorizedError,
  UnsupportedFileTypeError,
  ValidationError,
  isApiError,
} from "../src/utils/ApiError";
import { boolQuery, dateQuery, enumQuery, intQuery, queryString } from "../src/utils/query";
import { pipeToResponse } from "../src/utils/stream";

// ---------------- hierarquia de erros ----------------

test("cada erro tem status, código estável e nome da classe", () => {
  const cases: [ApiError, number, string][] = [
    [new BadRequestError(), 400, "BAD_REQUEST"],
    [new ValidationError(), 400, "VALIDATION_ERROR"],
    [new InvalidQueryError(), 400, "INVALID_QUERY"],
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new NotFoundError(), 404, "NOT_FOUND"],
    [new ConflictError(), 409, "CONFLICT"],
    [new PayloadTooLargeError(), 413, "PAYLOAD_TOO_LARGE"],
    [new UnsupportedFileTypeError(), 415, "UNSUPPORTED_FILE_TYPE"],
    [new InvalidStateError(), 422, "INVALID_STATE"],
    [new ExternalServiceError("clicksign"), 502, "EXTERNAL_SERVICE_ERROR"],
    [new StorageError(), 502, "STORAGE_ERROR"],
    [new ServiceUnavailableError(), 503, "SERVICE_UNAVAILABLE"],
    [new DatabaseUnavailableError(), 503, "DATABASE_UNAVAILABLE"],
  ];
  for (const [err, status, code] of cases) {
    assert.equal(err.statusCode, status, err.name);
    assert.equal(err.code, code, err.name);
    assert.ok(err instanceof ApiError && err instanceof Error, err.name);
    assert.ok(isApiError(err));
    assert.ok(err.message.length > 0, `${err.name} sem mensagem padrão`);
  }
});

test("subclasses preservam instanceof da classe mãe", () => {
  assert.ok(new ValidationError() instanceof BadRequestError);
  assert.ok(new DatabaseUnavailableError() instanceof ServiceUnavailableError);
  assert.equal(new ValidationError().name, "ValidationError");
});

test("isServerError separa 4xx de 5xx", () => {
  assert.equal(new NotFoundError().isServerError, false);
  assert.equal(new StorageError().isServerError, true);
});

test("assinatura antiga new ApiError(status, msg, details) continua funcionando", () => {
  const e = new ApiError(409, "Conflito de horário encontrado", [{ id: "x" }]);
  assert.equal(e.code, "CONFLICT");
  assert.deepEqual(e.details, [{ id: "x" }]);
  assert.equal(new ApiError(418, "bule").code, "BAD_REQUEST");
  assert.equal(new ApiError(500, "x").code, "INTERNAL_ERROR");
});

test("ExternalServiceError guarda o nome do serviço", () => {
  const e = new ExternalServiceError("whatsapp");
  assert.equal(e.service, "whatsapp");
  assert.match(e.message, /whatsapp/);
});

// ---------------- parâmetros de URL ----------------

const STATUS = ["REQUESTED", "SCHEDULED", "DONE"] as const;

test("enumQuery aceita valor válido, ignora vazio e normaliza caixa", () => {
  assert.equal(enumQuery("DONE", STATUS), "DONE");
  assert.equal(enumQuery("done", STATUS), "DONE");
  assert.equal(enumQuery(undefined, STATUS), undefined);
  assert.equal(enumQuery("", STATUS), undefined);
  assert.equal(enumQuery(["SCHEDULED", "DONE"], STATUS), "SCHEDULED");
  assert.equal(enumQuery("B", { A: "A", B: "B" } as Record<string, "A" | "B">), "B");
});

test("enumQuery recusa valor fora da lista com 400 e a lista aceita", () => {
  assert.throws(
    () => enumQuery("QUALQUER", STATUS, "status"),
    (e: unknown) => e instanceof InvalidQueryError && (e.details as { allowed: string[] }).allowed.length === 3
  );
  // tentativa de injeção de filtro do Prisma
  assert.throws(() => enumQuery({ not: "DONE" }, STATUS), InvalidQueryError);
});

test("dateQuery valida datas", () => {
  assert.equal(dateQuery("2026-09-13")?.toISOString(), "2026-09-13T00:00:00.000Z");
  assert.equal(dateQuery(undefined), undefined);
  assert.throws(() => dateQuery("13/09/2026"), InvalidQueryError);
  assert.throws(() => dateQuery("abc"), InvalidQueryError);
});

test("intQuery e boolQuery", () => {
  assert.equal(intQuery("42", { min: 1, max: 100 }), 42);
  assert.equal(intQuery(undefined), undefined);
  assert.throws(() => intQuery("4.2"), InvalidQueryError);
  assert.throws(() => intQuery("999", { max: 100 }), InvalidQueryError);
  assert.equal(boolQuery("1"), true);
  assert.equal(boolQuery("não"), false);
  assert.equal(boolQuery(undefined), undefined);
  assert.throws(() => boolQuery("talvez"), InvalidQueryError);
  assert.equal(queryString("  x  "), "x");
});

// ---------------- streaming de arquivos ----------------

/** Resposta falsa: PassThrough com a API mínima do Express usada pelo helper. */
function fakeResponse() {
  const res = new PassThrough() as unknown as Response & PassThrough & { sent?: { status: number; body: unknown } };
  let status = 200;
  let headersSent = false;
  Object.defineProperty(res, "headersSent", { get: () => headersSent });
  const origWrite = res.write.bind(res) as (...a: unknown[]) => boolean;
  (res as unknown as { write: (...a: unknown[]) => boolean }).write = (...args: unknown[]) => {
    headersSent = true;
    return origWrite(...args);
  };
  Object.assign(res, {
    removeHeader: () => undefined,
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (body: unknown) => {
      headersSent = true;
      res.sent = { status, body };
      res.end();
      return res;
    },
  });
  res.resume();
  return res;
}

test("stream que falha antes do primeiro byte responde 502 em JSON (sem derrubar o processo)", async () => {
  const src = new Readable({
    read() {
      this.destroy(new Error("disco sumiu"));
    },
  });
  const res = fakeResponse();
  const silence = console.error;
  console.error = () => undefined;
  try {
    await pipeToResponse(src, res);
  } finally {
    console.error = silence;
  }
  assert.equal(res.sent?.status, 502);
  assert.equal((res.sent?.body as { code: string }).code, "STORAGE_ERROR");
});

test("stream que falha no meio do download encerra a conexão sem exceção não tratada", async () => {
  let sent = false;
  const src = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.from("parte 1"));
      } else {
        setImmediate(() => this.destroy(new Error("conexão caiu")));
      }
    },
  });
  const res = fakeResponse();
  res.on("error", () => undefined);
  const silence = console.error;
  console.error = () => undefined;
  try {
    await pipeToResponse(src, res);
  } finally {
    console.error = silence;
  }
  assert.equal(res.sent, undefined, "não deve tentar mandar JSON depois de começar o download");
  assert.equal(res.destroyed, true);
});

test("stream que termina normalmente resolve", async () => {
  const res = fakeResponse();
  await pipeToResponse(Readable.from([Buffer.from("ok")]), res);
  assert.equal(res.sent, undefined);
});
