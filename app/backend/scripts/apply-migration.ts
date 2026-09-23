/**
 * Aplica uma migration pelo pooler em modo sessão (5432).
 *
 * O `prisma migrate deploy` trava contra o pooler em modo transação
 * (6543 + pgbouncer), que é a URL que a aplicação usa. Este script troca a
 * porta, roda o SQL e registra a migration em _prisma_migrations para o
 * Prisma não tentar aplicá-la de novo.
 *
 *   npx tsx scripts/apply-migration.ts 20260923140000_p2_documentos_montador
 *
 * Importar este arquivo não executa nada: tudo que tem efeito está dentro de
 * main(), para os testes poderem usar splitStatements sem derrubar o processo.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Separa as instruções em `;`, mas ignora o que estiver dentro de um bloco
 * $$ ... $$ — senão um DO $$ ... END $$ seria cortado no meio e cada pedaço
 * chegaria ao banco como SQL inválido.
 */
export function splitStatements(texto: string): string[] {
  const out: string[] = [];
  let atual = "";
  let dentroDeDollar = false;

  for (const linha of texto.split(/\r?\n/)) {
    // comentário de linha inteira não entra na instrução
    if (!dentroDeDollar && /^\s*--/.test(linha)) continue;

    // cada $$ alterna entrada/saída do bloco (dois marcadores por bloco)
    const marcadores = (linha.match(/\$\$/g) ?? []).length;
    if (marcadores % 2 === 1) dentroDeDollar = !dentroDeDollar;

    atual += linha + "\n";

    if (!dentroDeDollar && /;\s*$/.test(linha)) {
      const st = atual.trim();
      if (st) out.push(st);
      atual = "";
    }
  }
  const resto = atual.trim();
  if (resto) out.push(resto);
  return out;
}

/** URL da aplicação convertida para o modo sessão, que aceita DDL. */
export function sessionModeUrl(databaseUrl: string): string {
  return databaseUrl
    .replace(":6543/", ":5432/")
    .replace(/&?pgbouncer=true/, "")
    .replace(/&?connection_limit=1/, "");
}

async function main() {
  const nome = process.argv[2];
  if (!nome) {
    console.error("uso: npx tsx scripts/apply-migration.ts <nome_da_migration>");
    process.exit(1);
  }

  const arquivo = path.join("prisma", "migrations", nome, "migration.sql");
  if (!fs.existsSync(arquivo)) {
    console.error(`não encontrei ${arquivo}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(arquivo, "utf8");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: sessionModeUrl(process.env.DATABASE_URL ?? "") } } });

  const statements = splitStatements(sql);
  console.log(`${nome}: ${statements.length} instrução(ões)`);

  for (const [i, st] of statements.entries()) {
    const resumo = st.replace(/\s+/g, " ").slice(0, 70);
    try {
      await prisma.$executeRawUnsafe(st);
      console.log(`  ${i + 1}/${statements.length} ok   ${resumo}`);
    } catch (e) {
      console.error(`  ${i + 1}/${statements.length} FALHOU  ${resumo}`);
      throw e;
    }
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
     SELECT $1, $2, $3, now(), now(), 1
     WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $3)`,
    crypto.randomUUID(),
    crypto.createHash("sha256").update(sql).digest("hex"),
    nome
  );

  console.log("aplicada e registrada");
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("ERRO:", e instanceof Error ? e.message.split("\n")[0] : String(e));
    process.exit(1);
  });
}
