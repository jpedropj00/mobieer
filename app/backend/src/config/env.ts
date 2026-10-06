import { resolveAiEndpoint } from "./ai-endpoint";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET;

if (isProduction && !jwtSecret) {
  throw new Error("JWT_SECRET deve ser definido em produção");
}

const resolvedJwtSecret = jwtSecret || "mobieer-dev-secret";
const frontendUrls = (process.env.FRONTEND_URLS || "http://localhost:5173").split(",").map((s) => s.trim());
const storageDriver = (process.env.STORAGE_DRIVER || "disk").toLowerCase();
const mailDriver = (process.env.MAIL_DRIVER || "console").toLowerCase();

// --- Integrações externas (todas opcionais; sem credencial => modo fallback) ---
const bool = (v: string | undefined, dflt = false) =>
  v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

const aiApiKey = (process.env.AI_API_KEY || "").trim();
// endereço e modelo saem da própria chave quando AI_BASE_URL falta ou é de outro provedor
const aiEndpoint = resolveAiEndpoint(aiApiKey, process.env.AI_BASE_URL, process.env.AI_MODEL);
const signatureToken = process.env.SIGNATURE_API_TOKEN || "";
const nfeToken = process.env.NFE_API_TOKEN || "";

if (isProduction && storageDriver === "supabase" && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("STORAGE_DRIVER=supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
}

export const env = {
  isProduction,
  port: Number(process.env.PORT || 3333),
  databaseUrl: process.env.DATABASE_URL || "",
  appUrl: (process.env.APP_URL || frontendUrls[0] || "http://localhost:5173").replace(/\/$/, ""),
  // endereço público da API (o backend fica em outro domínio no Vercel).
  // Usado em links que apontam para o próprio backend, como o webhook do WhatsApp.
  apiUrl: (process.env.API_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") || `http://localhost:${process.env.PORT || 3333}`).replace(/\/$/, ""),
  frontendUrls,

  jwtSecret: resolvedJwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",

  portal: {
    jwtSecret: process.env.PORTAL_JWT_SECRET || `${resolvedJwtSecret}:portal`,
    jwtExpiresIn: process.env.PORTAL_JWT_EXPIRES_IN || "7d",
    path: process.env.PORTAL_PATH || "/portal",
  },

  storage: {
    driver: storageDriver as "disk" | "supabase",
    supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "project-documents",
    signedUrlTtl: Number(process.env.STORAGE_SIGNED_URL_TTL || 120),
  },

  mail: {
    driver: mailDriver as "console" | "resend",
    from: process.env.MAIL_FROM || "MOBIEER <no-reply@mobieer.com.br>",
    resendApiKey: process.env.RESEND_API_KEY || "",
  },

  clientFeedbackFormUrl: process.env.CLIENT_FEEDBACK_FORM_URL || "",

  // --- Agendador (Vercel Cron). O Vercel envia "Authorization: Bearer CRON_SECRET".
  //     Sem CRON_SECRET o endpoint /api/cron/* fica bloqueado em produção. ---
  cron: {
    secret: process.env.CRON_SECRET || "",
  },

  // --- IA (cronograma de produção). Cliente compatível com a API da OpenAI:
  //     serve OpenAI, xAI/Grok e afins trocando AI_BASE_URL + AI_MODEL.
  //     Sem AI_API_KEY => usa o gerador heurístico local. ---
  ai: {
    enabled: bool(process.env.AI_ENABLED, Boolean(aiApiKey)),
    baseUrl: aiEndpoint.baseUrl,
    apiKey: aiApiKey,
    model: aiEndpoint.model,
    providerName: aiEndpoint.provider,
    /** AI_BASE_URL apontava para outro provedor e foi trocado pelo da chave */
    endpointAdjusted: aiEndpoint.adjusted,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
  },

  // --- Mobieer AI (assistente da equipe). A chave fica só no backend.
  //     Sem GEMINI_API_KEY o assistente aparece como indisponível. ---
  assistant: {
    provider: (process.env.ASSISTANT_PROVIDER || "").trim().toLowerCase() as "" | "gemini" | "openai",
    apiKey: (process.env.GEMINI_API_KEY || "").trim(),
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 25000),
    // Render com IA (imagem a partir de imagem)
    imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview",
    imageTimeoutMs: Number(process.env.GEMINI_IMAGE_TIMEOUT_MS || 55000),
  },

  // --- Assinatura eletrônica (Clicksign). Sem SIGNATURE_API_TOKEN => segue
  //     valendo só a assinatura desenhada no portal. ---
  signature: {
    enabled: bool(process.env.SIGNATURE_ENABLED, Boolean(signatureToken)),
    provider: (process.env.SIGNATURE_PROVIDER || "clicksign").toLowerCase() as "clicksign",
    apiToken: signatureToken,
    baseUrl: (process.env.SIGNATURE_BASE_URL || "https://app.clicksign.com").replace(/\/$/, ""),
    // opcional: dispara o fluxo de assinatura por WhatsApp além do e-mail
    deliveryMethod: (process.env.SIGNATURE_DELIVERY || "email").toLowerCase() as "email" | "whatsapp",
  },

  // --- NF-e (via provedor: Focus NF-e, NFe.io, eNotas, ...). Sem NFE_API_TOKEN
  //     => o endpoint responde "provedor não configurado". ---
  nfe: {
    enabled: bool(process.env.NFE_ENABLED, Boolean(nfeToken)),
    provider: (process.env.NFE_PROVIDER || "focusnfe").toLowerCase(),
    apiToken: nfeToken,
    baseUrl: (process.env.NFE_BASE_URL || "").replace(/\/$/, ""),
    environment: (process.env.NFE_ENVIRONMENT || "homologacao").toLowerCase() as "homologacao" | "producao",
  },
};
