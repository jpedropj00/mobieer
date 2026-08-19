import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET;

if (isProduction && !jwtSecret) {
  throw new Error("JWT_SECRET deve ser definido em produção");
}

export const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: jwtSecret || "mobieer-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  frontendUrls: (process.env.FRONTEND_URLS || "http://localhost:5173").split(",").map((s) => s.trim()),
};
