import { env } from "../config/env";

/**
 * Emissão de NF-e / NFS-e via provedor homologado (Focus NF-e por padrão;
 * a mesma forma serve NFe.io / eNotas trocando NFE_BASE_URL + payload).
 *
 * Sem NFE_API_TOKEN + NFE_BASE_URL o `nfeEnabled()` é false e os endpoints
 * respondem "provedor não configurado" — nada é enviado à SEFAZ.
 */

export const nfeEnabled = () => env.nfe.enabled && Boolean(env.nfe.apiToken) && Boolean(env.nfe.baseUrl);

export class NfeError extends Error {}
export class NfeNotConfiguredError extends NfeError {
  constructor() {
    super("Emissão de NF-e não configurada (defina NFE_PROVIDER, NFE_API_TOKEN e NFE_BASE_URL)");
  }
}

export type NfeInvoicePayload = Record<string, unknown>;
export type NfeProviderResult = {
  ref: string;
  status: string; // ex: processando_autorizacao | autorizado | erro_autorizacao | cancelado
  providerRef?: string | null;
  number?: string | null;
  xmlUrl?: string | null;
  pdfUrl?: string | null;
  message?: string | null;
  raw: unknown;
};

// Focus NF-e usa Basic Auth com o token como usuário e senha vazia.
function authHeader() {
  return `Basic ${Buffer.from(`${env.nfe.apiToken}:`).toString("base64")}`;
}

function mapFocus(ref: string, raw: Record<string, unknown>): NfeProviderResult {
  return {
    ref,
    status: String(raw.status ?? "desconhecido"),
    providerRef: (raw.chave_nfe as string) ?? (raw.chave_nfse as string) ?? null,
    number: (raw.numero as string) ?? (raw.numero_nfse as string) ?? null,
    xmlUrl: (raw.caminho_xml_nota_fiscal as string) ?? (raw.url_xml as string) ?? null,
    pdfUrl: (raw.caminho_danfe as string) ?? (raw.url_danfe as string) ?? (raw.caminho_pdf_nota_fiscal as string) ?? null,
    message: (raw.mensagem_sefaz as string) ?? (raw.erros ? JSON.stringify(raw.erros) : null),
    raw,
  };
}

/** Envia a nota para emissão. `ref` é a referência idempotente do nosso lado. */
export async function issueInvoice(ref: string, payload: NfeInvoicePayload): Promise<NfeProviderResult> {
  if (!nfeEnabled()) throw new NfeNotConfiguredError();
  const res = await fetch(`${env.nfe.baseUrl}/v2/nfe?ref=${encodeURIComponent(ref)}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 500) throw new NfeError(`Provedor NF-e indisponível (HTTP ${res.status})`);
  return mapFocus(ref, raw);
}

export async function getInvoice(ref: string): Promise<NfeProviderResult> {
  if (!nfeEnabled()) throw new NfeNotConfiguredError();
  const res = await fetch(`${env.nfe.baseUrl}/v2/nfe/${encodeURIComponent(ref)}`, {
    headers: { Authorization: authHeader() },
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return mapFocus(ref, raw);
}

export async function cancelInvoice(ref: string, justificativa: string): Promise<NfeProviderResult> {
  if (!nfeEnabled()) throw new NfeNotConfiguredError();
  const res = await fetch(`${env.nfe.baseUrl}/v2/nfe/${encodeURIComponent(ref)}`, {
    method: "DELETE",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ justificativa }),
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return mapFocus(ref, raw);
}
