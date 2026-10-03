/**
 * Indexa a documentação do Mobieer AI (knowledge/docs/*.md) no banco:
 * corta em trechos, gera os embeddings no Gemini e grava em AiDocument/AiChunk.
 * Só reprocessa arquivo novo ou alterado; `--tudo` refaz todos.
 *
 *   npx tsx scripts/indexar-conhecimento.ts
 *   npx tsx scripts/indexar-conhecimento.ts --tudo
 *
 * Precisa de GEMINI_API_KEY no .env e da migration 20261003180000_assistente_ia aplicada.
 */
import "dotenv/config";

async function main() {
  const { reindexKnowledge } = await import("../src/modules/ai/rag/rag.service");
  const { prisma } = await import("../src/prisma");
  const r = await reindexKnowledge({ force: process.argv.includes("--tudo") });
  console.log(`Indexados: ${r.indexed.length} (${r.chunks} trechos)${r.indexed.length ? " — " + r.indexed.join(", ") : ""}`);
  console.log(`Sem mudança: ${r.skipped.length}`);
  if (r.removed.length) console.log(`Removidos: ${r.removed.join(", ")}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
