import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3333),
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET || "mobieer-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  frontendUrls: (process.env.FRONTEND_URLS || "http://localhost:5173").split(",").map((s) => s.trim()),
};
