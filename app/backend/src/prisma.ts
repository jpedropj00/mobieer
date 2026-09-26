import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./config/env"; // carrega o .env antes de ler a URL

/**
 * Conexão pelo driver `pg` em vez do motor do Prisma. Atrás do pooler do
 * Supabase (pgbouncer=true), o motor embrulha cada consulta em BEGIN +
 * DEALLOCATE ALL + consulta + COMMIT — quatro idas ao banco por consulta. O
 * `pg` usa comando sem nome e faz uma ida só, e o pooler aceita assim.
 */
export function pgAdapterFor(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const limit = Number(url.searchParams.get("connection_limit"));
  const sslmode = url.searchParams.get("sslmode");
  // parâmetros do Prisma que o `pg` não entende (e o sslmode, tratado abaixo)
  for (const k of ["pgbouncer", "connection_limit", "sslmode", "schema"]) url.searchParams.delete(k);
  return new PrismaPg({
    connectionString: url.toString(),
    // connection_limit=1 serializava todo Promise.all; o pooler aguenta mais
    max: Number.isFinite(limit) && limit > 1 ? limit : 5,
    idleTimeoutMillis: 10_000,
    // igual ao sslmode=require de antes: cifra sem conferir a cadeia do certificado
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: false } : undefined,
  });
}

// Sem URL (testes de unidade) o cliente nasce sem adapter e só falha se consultar.
export const prisma = env.databaseUrl ? new PrismaClient({ adapter: pgAdapterFor(env.databaseUrl) }) : new PrismaClient();
