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
};
