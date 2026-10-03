/**
 * Zera o banco para começar a usar de verdade: apaga TODOS os usuários e todos
 * os dados de demonstração (clientes, projetos, estoque, financeiro, comercial,
 * RH, chat, avisos, histórico) e deixa só a configuração — organização, empresa,
 * perfis e permissões, etapas do funil, tipos de agenda, categorias, centros de
 * custo, regras de imposto, modelos de documento, almoxarifado e ajustes.
 * No fim cria o primeiro administrador de verdade.
 *
 * NÃO TEM VOLTA. Faça um backup antes (Supabase → Database → Backups).
 *
 * 1) Simulação — só mostra o que seria apagado, não altera nada:
 *      npx tsx scripts/limpar-para-producao.ts
 *
 * 2) Para valer — informe o primeiro administrador e confirme:
 *      PowerShell:
 *        $env:ADMIN_NOME="Seu Nome"; $env:ADMIN_EMAIL="voce@empresa.com.br"; $env:ADMIN_SENHA="uma-senha-forte"
 *        npx tsx scripts/limpar-para-producao.ts --confirmar
 *
 * Tudo roda numa transação: se qualquer passo falhar, nada é apagado.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { sessionModeUrl } from "./apply-migration";

/** Configuração que fica. Qualquer outra tabela é esvaziada. */
const KEEP = new Set([
  "_prisma_migrations",
  "Organization",
  "Enterprise",
  "Role",
  "Permission",
  "RolePermission",
  "SalesStage",
  "AgendaEventType",
  "Category",
  "CostCenter",
  "TaxRule",
  "DocumentTemplate",
  "DocumentTemplateVersion",
  "Warehouse",
  "MessageAutomation",
  "CompanyHoliday",
  "DreCategoryMapping",
  "Setting",
  // base de conhecimento do Mobieer AI (as conversas, que são de usuários, saem)
  "AiDocument",
  "AiChunk",
]);
/** Ajustes que eram de teste (anotações da semana, cronogramas, ponto de equilíbrio de exemplo). */
const TEST_SETTINGS = ["weekly.%", "installation-schedule.%", "finance.breakeven.%", "materials-list.%", "tech-folder.%", "renders.%"];

type Fk = { tbl: string; col: string; ref: string; nullable: boolean };

async function main() {
  const confirm = process.argv.includes("--confirmar");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: sessionModeUrl(process.env.DATABASE_URL ?? "") } } });

  const tables = (await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`
  )).map((r) => r.t);
  const fks = await prisma.$queryRawUnsafe<Fk[]>(`
    SELECT cl.relname::text AS tbl, a.attname::text AS col, rf.relname::text AS ref, NOT a.attnotnull AS nullable
    FROM pg_constraint k
    JOIN pg_class cl ON cl.oid = k.conrelid
    JOIN pg_class rf ON rf.oid = k.confrelid
    JOIN pg_namespace s ON s.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.contype = 'f' AND s.nspname = 'public'`);

  const wipe = tables.filter((t) => !KEEP.has(t));
  const count = async (t: string) => (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;

  console.log(`\nBanco: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@/]+@/, ":***@").slice(0, 70)}…`);
  console.log(confirm ? "\n*** MODO PARA VALER ***" : "\n--- SIMULAÇÃO (nada será alterado) ---");

  console.log("\nSERÁ APAGADO:");
  let total = 0;
  for (const t of wipe) {
    const n = await count(t);
    total += n;
    if (n) console.log(`  ${t.padEnd(34)} ${n}`);
  }
  console.log(`  ${"TOTAL".padEnd(34)} ${total} registros em ${wipe.length} tabelas`);

  console.log("\nFICA (configuração):");
  for (const t of tables.filter((x) => KEEP.has(x) && x !== "_prisma_migrations")) console.log(`  ${t.padEnd(34)} ${await count(t)}`);

  // colunas das tabelas que ficam e apontam para algo que será apagado
  const dangling = fks.filter((f) => KEEP.has(f.tbl) && !KEEP.has(f.ref));
  if (dangling.length) {
    console.log("\nVÍNCULOS A AJUSTAR nas tabelas que ficam:");
    for (const f of dangling) console.log(`  ${f.tbl}.${f.col} → ${f.ref}: ${f.nullable ? "fica vazio" : f.ref === "User" ? "passa para o novo administrador" : "SEM SAÍDA (o script para aqui)"}`);
  }
  const blocked = dangling.filter((f) => !f.nullable && f.ref !== "User");
  if (blocked.length) throw new Error("Há vínculo obrigatório para tabela apagada — ajuste a lista KEEP antes de rodar.");

  if (!confirm) {
    console.log("\nNada foi alterado. Para executar: faça o backup, defina ADMIN_NOME, ADMIN_EMAIL e ADMIN_SENHA e rode com --confirmar.\n");
    await prisma.$disconnect();
    return;
  }

  const nome = (process.env.ADMIN_NOME ?? "").trim();
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA ?? "";
  if (nome.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Defina ADMIN_NOME e ADMIN_EMAIL (e-mail válido) do primeiro administrador.");
  if (senha.length < 10) throw new Error("ADMIN_SENHA precisa ter pelo menos 10 caracteres.");

  await prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.findFirstOrThrow({ select: { id: true } });
      const role = await tx.role.findFirstOrThrow({ where: { name: "ADMIN" }, select: { id: true } });

      // sai do caminho quem já usa esse e-mail, e entra o administrador novo
      await tx.$executeRawUnsafe(`UPDATE "User" SET email = email || '.removido.' || id WHERE lower(email) = $1`, email);
      const admin = await tx.user.create({
        data: { name: nome, email, password: await bcrypt.hash(senha, 12), roleId: role.id, organizationId: org.id, status: "ACTIVE", passwordChangedAt: new Date() },
        select: { id: true },
      });

      for (const f of dangling) {
        if (f.nullable) await tx.$executeRawUnsafe(`UPDATE "${f.tbl}" SET "${f.col}" = NULL WHERE "${f.col}" IS NOT NULL`);
        else await tx.$executeRawUnsafe(`UPDATE "${f.tbl}" SET "${f.col}" = $1`, admin.id);
      }
      // vínculos dentro das próprias tabelas apagadas que apontam para usuário e travariam a ordem
      for (const f of fks.filter((x) => !KEEP.has(x.tbl) && x.tbl !== "User" && x.ref === "User" && x.nullable)) {
        await tx.$executeRawUnsafe(`UPDATE "${f.tbl}" SET "${f.col}" = NULL WHERE "${f.col}" IS NOT NULL`);
      }

      // apaga em rodadas: quem ainda é referenciado por outra tabela espera a próxima
      let pending = [...wipe];
      for (let round = 1; pending.length; round++) {
        const next: string[] = [];
        for (const t of pending) {
          await tx.$executeRawUnsafe(`SAVEPOINT limpa`);
          try {
            if (t === "User") await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE id <> $1`, admin.id);
            else await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT limpa`);
          } catch {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT limpa`);
            next.push(t);
          }
        }
        if (next.length === pending.length) throw new Error(`Não consegui apagar (vínculos em ciclo): ${next.join(", ")}. Nada foi alterado.`);
        console.log(`  rodada ${round}: ${pending.length - next.length} tabelas limpas, ${next.length} aguardando`);
        pending = next;
      }

      for (const like of TEST_SETTINGS) await tx.$executeRawUnsafe(`DELETE FROM "Setting" WHERE key LIKE $1`, like);
    },
    { timeout: 300_000, maxWait: 20_000 }
  );

  console.log(`\nPronto. Banco limpo; administrador criado: ${email}. Entre no sistema e cadastre os demais usuários em Usuários.\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("\nERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
