/**
 * Gravação de uma importação do Promob — usada pela tela (upload manual) e
 * pelo sincronizador/plugin (token de integração).
 */
import { Prisma } from "@prisma/client";
import { storage, buildStorageKey } from "../../lib/storage";
import { prisma } from "../../prisma";
import { readPromobFile } from "./promob.adapters";
import { syncQuoteFromImport } from "../commercial/quote.promob";
import { fixUploadName } from "../../utils/upload-name";

export type PromobFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

export async function createPromobImport(opts: {
  organizationId: string;
  projectId: string;
  file: PromobFile;
  createdById: string | null;
  source: "MANUAL" | "SYNC";
}) {
  const file = { ...opts.file, originalname: fixUploadName(opts.file.originalname) };
  const read = await readPromobFile(file);
  const key = buildStorageKey(opts.projectId, `promob-${file.originalname}`);
  await storage.put(key, file.buffer, file.mimetype || "application/octet-stream");
  const { format, status, itemCount, totalValue, parsed, notes } = read;

  const row = await prisma.promobImport.create({
    data: {
      organizationId: opts.organizationId,
      projectId: opts.projectId,
      fileName: file.originalname,
      storageKey: key,
      mimeType: file.mimetype || "application/octet-stream",
      sizeBytes: file.size,
      format,
      source: opts.source,
      status,
      itemCount,
      totalValue,
      parsedJson: parsed === null ? Prisma.DbNull : (parsed as Prisma.InputJsonValue),
      notes,
      createdById: opts.createdById,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  // Promob → comercial: importação com valores vira (ou atualiza) o rascunho de orçamento do projeto.
  // Falha aqui não desfaz a importação: o arquivo fica salvo e o motivo vai no retorno.
  let quote: Awaited<ReturnType<typeof syncQuoteFromImport>> | null = null;
  if (row.status === "PARSED") {
    try {
      quote = await syncQuoteFromImport(row.id, opts.createdById);
    } catch (e) {
      quote = { skipped: e instanceof Error ? e.message : "falha ao gerar o orçamento" };
    }
  }
  return { ...row, quote };
}

/**
 * Descobre o projeto pelo nome do arquivo exportado: o código do projeto no
 * começo do nome ("364-1 Cozinha.xml", "364-1_orcamento.xml"). Usa o código
 * mais longo que casar, para "364-12" não virar "364-1".
 */
export function projectCodeFromFileName(fileName: string, codes: string[]): string | null {
  const base = fileName.replace(/\.[^.]+$/, "").trim().toLowerCase();
  const matches = codes.filter((code) => {
    const c = code.trim().toLowerCase();
    if (!c || !base.startsWith(c)) return false;
    // o código precisa terminar ali: "364-1" casa "364-1 Cozinha", não "364-12"
    const next = base.charAt(c.length);
    return next === "" || !/[a-z0-9]/.test(next);
  });
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}
