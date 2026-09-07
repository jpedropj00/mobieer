import { env } from "../config/env";

/**
 * Assinatura eletrônica via Clicksign (API v1, autenticada por access_token na
 * query string). Sem SIGNATURE_API_TOKEN o `signatureEnabled()` é false e o
 * fluxo continua usando apenas a assinatura desenhada no portal.
 *
 * Referência: https://developers.clicksign.com/docs
 */

export const signatureEnabled = () => env.signature.enabled && Boolean(env.signature.apiToken);

export class SignatureError extends Error {}

export type SignatureSigner = { name: string; email?: string | null; phone?: string | null; signAs?: string };
export type SignatureRequest = {
  fileName: string;
  contentBase64: string; // conteúdo do PDF/arquivo
  mimeType?: string;
  signers: SignatureSigner[];
  deadlineAt?: Date | null;
  locale?: string;
};
export type SignatureRequestResult = {
  providerRef: string; // document key
  signUrl: string | null;
  signerKeys: string[];
  status: string;
};

function api(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `${env.signature.baseUrl}/api/v1${path}${sep}access_token=${encodeURIComponent(env.signature.apiToken)}`;
}

async function call<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const res = await fetch(api(path), {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { errors?: unknown; message?: string };
  if (!res.ok) {
    const detail = typeof json.message === "string" ? json.message : JSON.stringify(json.errors ?? json);
    throw new SignatureError(`Clicksign ${method} ${path} => ${res.status}: ${detail}`);
  }
  return json as T;
}

/** Sobe o documento, cria os signatários e os vincula. Retorna a chave e o link. */
export async function createSignatureRequest(req: SignatureRequest): Promise<SignatureRequestResult> {
  if (!signatureEnabled()) throw new SignatureError("Provedor de assinatura não configurado");

  const mime = req.mimeType || "application/pdf";
  const doc = await call<{ document: { key: string; status: string } }>("/documents", "POST", {
    document: {
      path: `/mobieer/${req.fileName}`,
      content_base64: `data:${mime};base64,${req.contentBase64}`,
      deadline_at: (req.deadlineAt ?? new Date(Date.now() + 15 * 86400000)).toISOString(),
      auto_close: true,
      locale: req.locale || "pt-BR",
      sequence_enabled: false,
    },
  });
  const documentKey = doc.document.key;

  const signerKeys: string[] = [];
  for (const s of req.signers) {
    const created = await call<{ signer: { key: string } }>("/signers", "POST", {
      signer: {
        name: s.name,
        email: s.email || undefined,
        phone_number: s.phone || undefined,
        auths: [s.phone && !s.email ? "sms" : "email"],
        delivery: s.email ? "email" : "none",
      },
    });
    signerKeys.push(created.signer.key);
    await call("/lists", "POST", {
      list: { document_key: documentKey, signer_key: created.signer.key, sign_as: s.signAs || "sign" },
    });
  }

  // link direto de assinatura (o e-mail/SMS também é enviado pela Clicksign)
  const signUrl = `${env.signature.baseUrl}/sign/${documentKey}`;
  return { providerRef: documentKey, signUrl, signerKeys, status: doc.document.status };
}

export async function getSignatureStatus(documentKey: string): Promise<{ status: string; finishedAt: string | null }> {
  if (!signatureEnabled()) throw new SignatureError("Provedor de assinatura não configurado");
  const r = await call<{ document: { status: string; finished_at: string | null } }>(`/documents/${documentKey}`, "GET");
  return { status: r.document.status, finishedAt: r.document.finished_at };
}
