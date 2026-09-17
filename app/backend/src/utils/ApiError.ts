/**
 * Erros de domínio da API.
 *
 * Toda falha esperada deve sair como uma subclasse de `ApiError`: o
 * `errorHandler` responde com `{ success: false, code, message, details }` e o
 * status HTTP certo. Qualquer coisa que NÃO seja `ApiError` é tratada como bug
 * (500 genérico, com `errorId` para rastrear no log).
 *
 * `code` é estável e legível por máquina — o frontend pode reagir a ele sem
 * depender do texto da mensagem.
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "INVALID_QUERY"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "REFERENCE_CONFLICT"
  | "INVALID_STATE"
  | "FILE_TOO_LARGE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "UPLOAD_ERROR"
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE_ERROR"
  | "STORAGE_ERROR"
  | "DATABASE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const DEFAULT_CODE: Record<number, ErrorCode> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_FILE_TYPE",
  422: "INVALID_STATE",
  429: "RATE_LIMITED",
  502: "EXTERNAL_SERVICE_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

export class ApiError extends Error {
  statusCode: number;
  code: ErrorCode;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown, code?: ErrorCode) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.details = details;
    this.code = code ?? DEFAULT_CODE[statusCode] ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 5xx: falha nossa ou de dependência; 4xx: problema na requisição. */
  get isServerError() {
    return this.statusCode >= 500;
  }
}

// ---------------- 4xx: problema na requisição ----------------

export class BadRequestError extends ApiError {
  constructor(message = "Requisição inválida", details?: unknown, code: ErrorCode = "BAD_REQUEST") {
    super(400, message, details, code);
  }
}

/** Dados de entrada que não passaram na validação (campo a campo em `details`). */
export class ValidationError extends BadRequestError {
  constructor(message = "Dados inválidos", details?: unknown) {
    super(message, details, "VALIDATION_ERROR");
  }
}

/** Filtro/parâmetro de URL inválido (enum desconhecido, data inválida, ...). */
export class InvalidQueryError extends BadRequestError {
  constructor(message = "Parâmetro de consulta inválido", details?: unknown) {
    super(message, details, "INVALID_QUERY");
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Não autenticado") {
    super(401, message, undefined, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Sem permissão para esta ação") {
    super(403, message, undefined, "FORBIDDEN");
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Recurso não encontrado", details?: unknown) {
    super(404, message, details, "NOT_FOUND");
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Conflito com o estado atual do registro", details?: unknown, code: ErrorCode = "CONFLICT") {
    super(409, message, details, code);
  }
}

/** Ação não permitida no estado atual (ex.: concluir medição cancelada). */
export class InvalidStateError extends ApiError {
  constructor(message = "Ação não permitida no estado atual", details?: unknown) {
    super(422, message, details, "INVALID_STATE");
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message = "Arquivo ou conteúdo maior que o permitido", details?: unknown, code: ErrorCode = "PAYLOAD_TOO_LARGE") {
    super(413, message, details, code);
  }
}

export class UnsupportedFileTypeError extends ApiError {
  constructor(message = "Formato de arquivo não permitido", details?: unknown) {
    super(415, message, details, "UNSUPPORTED_FILE_TYPE");
  }
}

// ---------------- 5xx: dependência ou servidor ----------------

/** Provedor externo falhou (WhatsApp, Clicksign, NF-e, IA, ...). */
export class ExternalServiceError extends ApiError {
  service: string;
  constructor(service: string, message = `Serviço externo indisponível: ${service}`, details?: unknown) {
    super(502, message, details, "EXTERNAL_SERVICE_ERROR");
    this.service = service;
  }
}

/** Falha ao gravar/ler arquivo no storage (disco ou Supabase). */
export class StorageError extends ApiError {
  constructor(message = "Falha ao acessar o armazenamento de arquivos", details?: unknown) {
    super(502, message, details, "STORAGE_ERROR");
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = "Serviço temporariamente indisponível. Tente novamente em instantes.", code: ErrorCode = "SERVICE_UNAVAILABLE") {
    super(503, message, undefined, code);
  }
}

export class DatabaseUnavailableError extends ServiceUnavailableError {
  constructor(message = "Banco de dados indisponível no momento. Tente novamente em instantes.") {
    super(message, "DATABASE_UNAVAILABLE");
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
