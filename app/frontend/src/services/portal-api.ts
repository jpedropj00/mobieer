const API_BASE = "/api/portal";
const TOKEN_KEY = "mobieer_portal_token";

import { ApiError, errorFromResponse, readJson, safeFetch } from "@/lib/errors";

/** Mesmo formato do erro do app interno (mesmo `code`/`errorId`). */
export class PortalApiError extends ApiError {}

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function setPortalToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getPortalToken() {
  return token;
}

async function portalFailure(res: Response, payload?: unknown) {
  if (res.status === 401 && token) {
    setPortalToken(null);
    window.dispatchEvent(new Event("mobieer:portal-unauthorized"));
  }
  const e = await errorFromResponse(res, payload);
  return new PortalApiError(e.status, e.message, e.details, e.code, e.errorId);
}

type Options = { method?: string; body?: unknown; headers?: Record<string, string> };

export async function portalApi<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, headers } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await safeFetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  const payload = await readJson(res);
  if (!res.ok) throw await portalFailure(res, payload);
  return payload as T;
}

export const portalGet = <T>(path: string) => portalApi<T>(path);
export const portalPost = <T>(path: string, body?: unknown) => portalApi<T>(path, { method: "POST", body });
export const portalPatch = <T>(path: string, body?: unknown) => portalApi<T>(path, { method: "PATCH", body });
export const portalDelete = <T>(path: string) => portalApi<T>(path, { method: "DELETE" });

/** Busca um arquivo autenticado e devolve um object URL (lembre de revogar). */
export async function portalObjectUrl(path: string): Promise<string> {
  const res = await safeFetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw await portalFailure(res);
  return URL.createObjectURL(await res.blob());
}

/** Baixa um documento autenticado (o backend responde com redirect assinado ou o arquivo). */
export async function portalDownload(path: string, fileName: string) {
  const res = await safeFetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await portalFailure(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
