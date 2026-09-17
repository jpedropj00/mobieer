/**
 * Erros do lado do app.
 *
 * Tudo que sai da API vira `ApiError` (com o `code` estável do backend) e toda
 * falha de rede vira `NetworkError`. `errorMessage` nunca mostra texto técnico
 * em inglês ("Failed to fetch", "Unexpected token <") para o usuário.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  /** Id do erro 500 no log do servidor, para o suporte localizar. */
  errorId?: string;

  constructor(status: number, message: string, details?: unknown, code?: string, errorId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
    this.errorId = errorId;
  }
}

/**
 * Erro de regra do próprio app com mensagem pronta para o usuário
 * (ex.: "Escolha um arquivo"). Use no lugar de `new Error(...)` em mutations.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

/** Não foi possível falar com o servidor (offline, DNS, CORS, servidor fora). */
export class NetworkError extends Error {
  constructor(message = "Sem conexão com o servidor. Verifique a internet e tente novamente.") {
    super(message);
    this.name = "NetworkError";
  }
}

type ErrorPayload = { message?: string; code?: string; details?: unknown; errorId?: string };

const STATUS_FALLBACK: Record<number, string> = {
  400: "Requisição inválida",
  401: "Sessão expirada. Entre novamente.",
  403: "Você não tem permissão para esta ação",
  404: "Não encontrado",
  408: "O servidor demorou para responder. Tente novamente.",
  409: "Conflito com o estado atual do registro",
  413: "Arquivo maior que o permitido",
  415: "Formato de arquivo não permitido",
  429: "Muitas tentativas. Aguarde um instante.",
  500: "Erro interno do servidor",
  502: "Serviço externo indisponível no momento",
  503: "Serviço temporariamente indisponível. Tente novamente em instantes.",
  504: "O servidor demorou para responder. Tente novamente.",
};

/** `fetch` que troca a falha de rede crua por `NetworkError`. */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new NetworkError();
  }
}

/** Lê o corpo JSON sem estourar quando a resposta é HTML (ex.: 504 do Vercel) ou vazia. */
export async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Monta o `ApiError` de uma resposta não-OK. */
export async function errorFromResponse(response: Response, payload?: unknown): Promise<ApiError> {
  const body = ((payload === undefined ? await readJson(response) : payload) ?? {}) as ErrorPayload;
  const message = body.message || STATUS_FALLBACK[response.status] || `Erro ${response.status}`;
  return new ApiError(response.status, message, body.details, body.code, body.errorId);
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** Erro ao baixar um pedaço do app depois de um deploy novo. */
export function isChunkLoadError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed|error loading dynamically imported module/i.test(
    msg
  );
}

/** Mensagem pronta para toast/tela. */
export function errorMessage(err: unknown, fallback = "Erro inesperado"): string {
  if (err instanceof ApiError) {
    const base = err.message || STATUS_FALLBACK[err.status] || fallback;
    return err.status >= 500 && err.errorId ? `${base} (código ${err.errorId})` : base;
  }
  if (err instanceof NetworkError) return err.message;
  if (isChunkLoadError(err)) return "O sistema foi atualizado. Recarregue a página.";
  if (err instanceof AppError) return err.message;
  return fallback;
}

/**
 * Política de retry do React Query: repete só o que pode dar certo na segunda
 * vez (rede, 5xx, 408/429). Erro 4xx de regra de negócio não adianta repetir.
 */
export function shouldRetry(failureCount: number, err: unknown) {
  if (failureCount >= 2) return false;
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 408 || err.status === 429;
  return false;
}
