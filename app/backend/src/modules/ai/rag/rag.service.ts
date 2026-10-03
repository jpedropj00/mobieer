/**
 * RAG do Mobieer AI: busca os trechos da documentação mais parecidos com a
 * pergunta e reindexa knowledge/docs. Com um provedor que tem embeddings a
 * busca é vetorial (pgvector, distância do cosseno); sem, é por palavras (BM25).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../../prisma";
import { MAX_CONTEXT_CHUNKS, MIN_SIMILARITY, chunkMarkdown, embeddingText, lexicalSearch, toVectorLiteral, type RetrievedChunk } from "../assistant.rules";
import { aiProvider } from "../provider";

export async function searchKnowledge(question: string): Promise<RetrievedChunk[]> {
  if (!aiProvider().embeddings) {
    const rows = await prisma.aiChunk.findMany({ select: { section: true, content: true, document: { select: { slug: true, title: true } } } });
    return lexicalSearch(question, rows.map((r) => ({ document: r.document.slug, title: r.document.title, section: r.section, content: r.content })));
  }
  const [vector] = await aiProvider().embed([question], "query");
  const rows = await prisma.$queryRawUnsafe<{ document: string; title: string; section: string; content: string; similarity: number }[]>(
    `SELECT d."slug" AS document, d."title" AS title, c."section" AS section, c."content" AS content,
            (1 - (c."embedding" <=> $1::vector))::float8 AS similarity
       FROM "AiChunk" c JOIN "AiDocument" d ON d."id" = c."documentId"
      WHERE c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> $1::vector
      LIMIT ${MAX_CONTEXT_CHUNKS}`,
    toVectorLiteral(vector)
  );
  return rows.filter((r) => r.similarity >= MIN_SIMILARITY);
}

export async function knowledgeStats() {
  const [documents, chunks] = await Promise.all([prisma.aiDocument.count(), prisma.aiChunk.count()]);
  return { documents, chunks };
}

export function knowledgeDir() {
  const candidates = [path.join(process.cwd(), "knowledge", "docs"), path.join(__dirname, "..", "..", "..", "..", "knowledge", "docs")];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) throw new Error("Pasta knowledge/docs não encontrada");
  return dir;
}

/**
 * Reindexa a documentação: arquivo novo ou alterado é cortado e recebe
 * embeddings; arquivo igual é pulado; arquivo que saiu da pasta é removido.
 */
export async function reindexKnowledge(opts: { force?: boolean } = {}) {
  const dir = knowledgeDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const report = { indexed: [] as string[], skipped: [] as string[], removed: [] as string[], chunks: 0 };

  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(text).digest("hex");
    const existing = await prisma.aiDocument.findUnique({ where: { slug: file }, select: { id: true, checksum: true } });
    if (existing && existing.checksum === checksum && !opts.force) {
      report.skipped.push(file);
      continue;
    }
    const { title, chunks } = chunkMarkdown(text);
    const vectors = aiProvider().embeddings ? await aiProvider().embed(chunks.map((c) => embeddingText(title, c)), "document") : null;

    await prisma.$transaction(async (tx) => {
      const doc = existing
        ? await tx.aiDocument.update({ where: { id: existing.id }, data: { title, checksum }, select: { id: true } })
        : await tx.aiDocument.create({ data: { slug: file, title, checksum }, select: { id: true } });
      await tx.aiChunk.deleteMany({ where: { documentId: doc.id } });
      for (const [i, c] of chunks.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "AiChunk" ("id", "documentId", "position", "section", "content", "metadata", "embedding") VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::text::vector)`,
          crypto.randomUUID(),
          doc.id,
          i,
          c.section,
          c.content,
          JSON.stringify({ document: file, section: c.section }),
          vectors ? toVectorLiteral(vectors[i]) : null
        );
      }
    }, { timeout: 60_000 });
    report.indexed.push(file);
    report.chunks += chunks.length;
  }

  const stale = await prisma.aiDocument.findMany({ where: { slug: { notIn: files } }, select: { id: true, slug: true } });
  if (stale.length) {
    await prisma.aiDocument.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    report.removed = stale.map((s) => s.slug);
  }
  return report;
}
