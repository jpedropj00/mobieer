/**
 * Gravação de uma importação do Promob — usada pela tela (upload manual) e
 * pelo sincronizador/plugin (token de integração).
 */
import { Prisma } from "@prisma/client";
import { storage, buildStorageKey } from "../../lib/storage";
import { prisma } from "../../prisma";
import { decodeXmlBuffer, detectFormat, parsePromobXml } from "./promob.service";

export type PromobFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

export async function createPromobImport(opts: {
  organizationId: string;
  projectId: string;
  file: PromobFile;
  createdById: string | null;
  source: "MANUAL" | "SYNC";
}) {
  const { file } = opts;
  const format = detectFormat(file.originalname, file.mimetype);
  const key = buildStorageKey(opts.projectId, `promob-${file.originalname}`);
  await storage.put(key, file.buffer, file.mimetype || "application/octet-stream");

  let status = "UPLOADED";
  let itemCount = 0;
  let totalValue: number | null = null;
  let parsed: unknown = null;
  let notes: string | null = null;

  if (format === "XML") {
    try {
      const p = parsePromobXml(decodeXmlBuffer(file.buffer));
      parsed = p;
      itemCount = p.totals.itens;
      totalValue = p.totals.valor ?? null;
      status = p.totals.itens > 0 || p.totals.ambientes > 0 ? "PARSED" : "PARSE_FAILED";
      if (status === "PARSE_FAILED") notes = "XML lido, mas nenhum <ITEM>/<AMBIENTE> reconhecido nesta versão de export.";
    } catch (e) {
      status = "PARSE_FAILED";
      notes = `Falha ao ler o XML: ${e instanceof Error ? e.message : e}`;
    }
  } else if (format === "PDF") {
    notes = "PDF armazenado. A extração automática de itens só é feita para o XML de orçamento do Promob.";
  } else {
    notes = "Formato não reconhecido — arquivo armazenado para conferência manual.";
  }

  return prisma.promobImport.create({
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
