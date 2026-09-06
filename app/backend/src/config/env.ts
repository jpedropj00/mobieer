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

const whatsappToken = process.env.WHATSAPP_TOKEN || "";
const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const aiApiKey = process.env.AI_API_KEY || "";
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

  // --- WhatsApp Business (Meta Cloud API) ---
  // Sem WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID => mensagens só vão para o log.
  whatsapp: {
    enabled: bool(process.env.WHATSAPP_ENABLED, Boolean(whatsappToken && whatsappPhoneId)),
    provider: (process.env.WHATSAPP_PROVIDER || "meta").toLowerCase() as "meta",
    token: whatsappToken,
    phoneNumberId: whatsappPhoneId,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || "v21.0",
    // idioma padrão dos templates aprovados na Meta
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR",
  },

  // --- IA (cronograma de produção). Cliente compatível com a API da OpenAI:
  //     serve OpenAI, xAI/Grok e afins trocando AI_BASE_URL + AI_MODEL.
  //     Sem AI_API_KEY => usa o gerador heurístico local. ---
  ai: {
    enabled: bool(process.env.AI_ENABLED, Boolean(aiApiKey)),
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    apiKey: aiApiKey,
    model: process.env.AI_MODEL || "gpt-4o-mini",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),
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
