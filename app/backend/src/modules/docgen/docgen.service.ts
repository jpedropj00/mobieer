/**
 * Geração de documentos a partir dos dados do projeto (§21).
 *
 * Cada documento tem um builder puro que recebe os dados e devolve título,
 * corpo e rodapé — testável sem PDF nem banco. O PDF sai do mesmo gerador que
 * o contrato já usa, e a gravação cria um ProjectDocument versionado com
 * checksum, para ficar provado qual arquivo foi entregue.
 *
 * Regra de ouro: builder só escreve o que recebeu. Dado técnico ausente vira
 * o aviso MISSING, nunca um valor inventado.
 */
import crypto from "node:crypto";
import type { ProjectDocumentType } from "@prisma/client";
import { buildStorageKey, storage } from "../../lib/storage";
import { prisma } from "../../prisma";
import { brl, contractPdf, moneyToWords } from "../templates/contract.service";

/** Texto padrão para informação técnica que não existe no sistema. */
export const MISSING = "Informação técnica não disponível — revisão necessária.";

const FORTALEZA_TZ = "America/Fortaleza";
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: FORTALEZA_TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : MISSING;
/** Data de calendário (vencimento, data prevista): lida em UTC. */
export const fmtCalendarDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }) : MISSING;

export type BuiltDocument = { title: string; body: string; footer?: string };

// ---------------------------------------------------------------------------
// Recibo
// ---------------------------------------------------------------------------

export type ReceiptData = {
  number: string; // REC-<pagamento>
  company: { name: string; document: string | null };
  payer: { name: string; document: string | null };
  amount: number;
  paidAt: Date;
  method: string | null;
  reference: string; // "Parcela 2/5 do contrato 364-1"
  projectCode: string | null;
  issuedAt: Date;
};

/** Recibo de pagamento. Só existe depois que o financeiro confirmou o pagamento. */
export function buildReceipt(d: ReceiptData): BuiltDocument {
  if (!(d.amount > 0)) throw new Error("Recibo precisa de valor maior que zero");
  const docOf = (x: string | null) => (x ? `, inscrito(a) sob o nº ${x}` : "");
  const body = [
    `RECIBO Nº ${d.number}`,
    "",
    `Recebemos de ${d.payer.name}${docOf(d.payer.document)}, a importância de ${brl(d.amount)} (${moneyToWords(d.amount)}), referente a ${d.reference}.`,
    "",
    `Data do pagamento: ${fmtDate(d.paidAt)}`,
    `Forma de pagamento: ${d.method || "não informada"}`,
    ...(d.projectCode ? [`Projeto: ${d.projectCode}`] : []),
    "",
    `Para clareza, firmamos o presente recibo, dando plena quitação do valor acima.`,
    "",
    `Fortaleza, ${fmtDate(d.issuedAt)}.`,
    "",
    "",
    `${d.company.name}${d.company.document ? ` — CNPJ ${d.company.document}` : ""}`,
  ].join("\n");
  return {
    title: "Recibo",
    body,
    footer: `Documento gerado pelo sistema em ${fmtDate(d.issuedAt)}. Código de verificação no rodapé do arquivo.`,
  };
}

/** Número do recibo: estável por pagamento, então gerar de novo não cria outro número. */
export const receiptNumber = (paymentId: string) => `REC-${paymentId.slice(-8).toUpperCase()}`;

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

export const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * Grava um documento gerado. Se já existe um do mesmo tipo e origem para o
 * mesmo alvo, o novo vira a versão seguinte (replacesId) — o anterior não é
 * sobrescrito nem apagado.
 */
export async function storeGeneratedPdf(opts: {
  organizationId: string;
  clientId: string;
  projectId: string | null;
  type: ProjectDocumentType;
  generatedFrom: string;
  title: string;
  fileName: string;
  built: BuiltDocument;
  visibleToClient: boolean;
  uploadedById: string | null;
  replacesId?: string | null;
}) {
  const buffer = await contractPdf(opts.built);
  const checksum = sha256(buffer);
  const key = buildStorageKey(opts.projectId ? `projects/${opts.projectId}/generated` : `clients/${opts.clientId}/generated`, opts.fileName);
  await storage.put(key, buffer, "application/pdf");

  const previous = opts.replacesId
    ? await prisma.projectDocument.findUnique({ where: { id: opts.replacesId }, select: { id: true, version: true } })
    : null;

  try {
    return await prisma.projectDocument.create({
      data: {
        organizationId: opts.organizationId,
        clientId: opts.clientId,
        projectId: opts.projectId,
        type: opts.type,
        title: opts.title,
        storageKey: key,
        fileName: opts.fileName,
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        checksum,
        visibleToClient: opts.visibleToClient,
        generatedFrom: opts.generatedFrom,
        version: previous ? previous.version + 1 : 1,
        replacesId: previous?.id ?? null,
        uploadedById: opts.uploadedById,
      },
    });
  } catch (e) {
    await storage.remove(key).catch(() => undefined); // não deixa arquivo órfão
    throw e;
  }
}
