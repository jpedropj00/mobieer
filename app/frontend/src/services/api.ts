const API_BASE = "/api";

import { ApiError, NetworkError, errorFromResponse, readJson, safeFetch } from "@/lib/errors";

// Reexportado para quem já importa daqui.
export { ApiError };

let accessToken: string | null = localStorage.getItem("mobieer_token");

export function setToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem("mobieer_token", token);
  else localStorage.removeItem("mobieer_token");
}

export function getToken() {
  return accessToken;
}

/** Resposta de erro -> ApiError; 401 com sessão ativa derruba o login. */
async function failure(response: Response, payload?: unknown) {
  if (response.status === 401 && accessToken) {
    setToken(null);
    window.dispatchEvent(new Event("mobieer:unauthorized"));
  }
  return errorFromResponse(response, payload);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** desiste depois deste tempo (ms) em vez de esperar para sempre */
  timeoutMs?: number;
};

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, headers, timeoutMs } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") search.set(k, String(v));
    });
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await safeFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
  } catch (e) {
    // estourou o tempo: vira erro de rede, que as telas sabem mostrar e repetir
    if (controller?.signal.aborted) throw new NetworkError("O servidor demorou para responder. Tente novamente.");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const payload = await readJson(response);
  if (!response.ok) throw await failure(response, payload);
  return payload as T;
}

export const apiGet = <T>(path: string, params?: RequestOptions["params"]) => api<T>(path, { params });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return apiPostForm<T>(path, form);
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const response = await safeFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: form,
  });
  const payload = await readJson(response);
  if (!response.ok) throw await failure(response, payload);
  return payload as T;
}

/** Busca um arquivo autenticado e devolve um object URL (lembre de revogar). */
export async function apiObjectUrl(path: string): Promise<string> {
  const response = await safeFetch(`${API_BASE}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!response.ok) throw await failure(response);
  return URL.createObjectURL(await response.blob());
}

/** Abre um arquivo autenticado numa aba nova (link direto não leva o token). */
export async function apiOpen(path: string) {
  const tab = window.open("", "_blank");
  try {
    const url = await apiObjectUrl(path);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Baixa um arquivo autenticado (o backend responde com redirect assinado ou o arquivo). */
export async function apiDownload(path: string, fileName: string) {
  const response = await safeFetch(`${API_BASE}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!response.ok) throw await failure(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
