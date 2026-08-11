const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let accessToken: string | null = localStorage.getItem("mobieer_token");

export function setToken(token: string | null) {
  accessToken = token;
  if (token) localStorage.setItem("mobieer_token", token);
  else localStorage.removeItem("mobieer_token");
}

export function getToken() {
  return accessToken;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, headers } = options;

  let url = `${API_BASE}${path}`;
  if (params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") search.set(k, String(v));
    });
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (contentType.includes("application/json")) {
    payload = await response.json();
  }

  if (!response.ok) {
    const message = (payload as { message?: string })?.message ?? `Erro ${response.status}`;
    throw new ApiError(response.status, message, (payload as { details?: unknown })?.details);
  }

  return payload as T;
}

export const apiGet = <T>(path: string, params?: RequestOptions["params"]) => api<T>(path, { params });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });
