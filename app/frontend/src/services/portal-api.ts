const API_BASE = "/api/portal";
const TOKEN_KEY = "mobieer_portal_token";

export class PortalApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function setPortalToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getPortalToken() {
  return token;
}

type Options = { method?: string; body?: unknown; headers?: Record<string, string> };

export async function portalApi<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, headers } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload: unknown = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    payload = await res.json();
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      setPortalToken(null);
      window.dispatchEvent(new Event("mobieer:portal-unauthorized"));
    }
    const message = (payload as { message?: string })?.message ?? `Erro ${res.status}`;
    throw new PortalApiError(res.status, message, (payload as { details?: unknown })?.details);
  }
  return payload as T;
}

export const portalGet = <T>(path: string) => portalApi<T>(path);
export const portalPost = <T>(path: string, body?: unknown) => portalApi<T>(path, { method: "POST", body });

/** Baixa um documento autenticado (o backend responde com redirect assinado ou o arquivo). */
export async function portalDownload(path: string, fileName: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new PortalApiError(res.status, `Erro ${res.status}`);
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
