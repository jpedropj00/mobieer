/**
 * PDF assinado: o original com um carimbo no rodapé de cada página e uma
 * página de assinaturas no fim (imagem desenhada, nome, papel, data/hora, IP e
 * o SHA-256 do arquivo original). É a assinatura eletrônica simples que a
 * plataforma já coleta, agora gravada no arquivo — não é certificado ICP.
 *
 * Original que não é PDF (Word, imagem): sai só a página de assinaturas, que
 * aponta para o arquivo pelo hash.
 */
import crypto from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type Signer = {
  role: string;
  roleLabel: string;
  name: string;
  /** data:image/png|jpeg;base64,... */
  dataUrl: string;
  signedAt: Date;
  ip: string | null;
  /** como assinou: "sistema (usuário interno)", "portal do cliente"... */
  via: string;
};

export type SignedPdfInput = {
  original: Buffer;
  mimeType: string;
  fileName: string;
  title: string;
  documentId: string;
  organizationName: string | null;
  signers: Signer[];
  now?: Date;
};

export const sha256Hex = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

const TZ = "America/Fortaleza";
const fmt = (d: Date) =>
  `${d.toLocaleDateString("pt-BR", { timeZone: TZ })} às ${d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" })} (horário de Brasília)`;

/** Fonte padrão do PDF só conhece WinAnsi: o que não couber vira "?" em vez de derrubar a geração. */
function safe(font: PDFFont, text: string) {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Quebra o texto em linhas que caibam na largura. */
function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of safe(font, text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function decodeImage(dataUrl: string): { kind: "png" | "jpg"; bytes: Buffer } | null {
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return null;
  return { kind: m[1] === "png" ? "png" : "jpg", bytes: Buffer.from(m[2], "base64") };
}

export async function buildSignedPdf(input: SignedPdfInput): Promise<{ pdf: Buffer; originalHash: string; mergedOriginal: boolean }> {
  const now = input.now ?? new Date();
  const originalHash = sha256Hex(input.original);
  const shortHash = originalHash.slice(0, 16).toUpperCase();

  let doc: PDFDocument;
  let mergedOriginal = false;
  if (input.mimeType === "application/pdf") {
    try {
      doc = await PDFDocument.load(input.original, { ignoreEncryption: false, updateMetadata: false });
      if (doc.getPageCount() < 1) throw new Error("PDF sem páginas"); // arquivo quebrado "carrega" e falha ao ler as páginas
      mergedOriginal = true;
    } catch {
      doc = await PDFDocument.create(); // PDF protegido ou corrompido: fica só o certificado
    }
  } else {
    doc = await PDFDocument.create();
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.35, 0.35, 0.35);

  // Carimbo no rodapé de cada página do original
  if (mergedOriginal) {
    const names = input.signers.map((s) => s.name).join(", ");
    const stamp = `Assinado eletronicamente por ${names} — código ${shortHash} — ver página de assinaturas ao final`;
    for (const page of doc.getPages()) {
      const { width } = page.getSize();
      const lines = wrap(font, stamp, 7, width - 60).slice(0, 2);
      lines.forEach((l, i) => page.drawText(l, { x: 30, y: 14 + (lines.length - 1 - i) * 9, size: 7, font, color: gray }));
    }
  }

  // Página(s) de assinaturas
  const A4: [number, number] = [595.28, 841.89];
  let page: PDFPage = doc.addPage(A4);
  const M = 50;
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;
  const text = (t: string, opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = opts.size ?? 10;
    for (const l of wrap(opts.f ?? font, t, size, W)) {
      if (y < M + size) {
        page = doc.addPage(A4);
        y = A4[1] - M;
      }
      page.drawText(l, { x: M, y: y - size, size, font: opts.f ?? font, color: opts.color });
      y -= size + 4;
    }
  };

  text("PÁGINA DE ASSINATURAS", { size: 15, f: bold });
  y -= 4;
  text(input.title, { size: 11, f: bold });
  if (input.organizationName) text(input.organizationName, { size: 9, color: gray });
  y -= 6;
  text(`Arquivo original: ${input.fileName}`, { size: 9 });
  text(`SHA-256 do original: ${originalHash}`, { size: 8 });
  text(`Documento nº ${input.documentId} · página gerada em ${fmt(now)}`, { size: 8, color: gray });
  y -= 10;

  for (const s of input.signers) {
    const boxH = 118;
    if (y - boxH < M) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
    const top = y;
    page.drawRectangle({ x: M, y: top - boxH, width: W, height: boxH, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.8 });
    const img = decodeImage(s.dataUrl);
    if (img) {
      try {
        const embedded = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const scale = Math.min(200 / embedded.width, 70 / embedded.height, 1);
        page.drawImage(embedded, { x: M + 12, y: top - 16 - embedded.height * scale, width: embedded.width * scale, height: embedded.height * scale });
      } catch {
        page.drawText("(imagem da assinatura inválida)", { x: M + 12, y: top - 50, size: 8, font, color: gray });
      }
    }
    page.drawLine({ start: { x: M + 12, y: top - 92 }, end: { x: M + 232, y: top - 92 }, thickness: 0.6, color: gray });
    page.drawText(safe(bold, s.name), { x: M + 12, y: top - 104, size: 9.5, font: bold });
    const info = [
      `Papel: ${s.roleLabel}`,
      `Assinado em ${fmt(s.signedAt)}`,
      `Meio: ${s.via}`,
      `IP: ${s.ip ?? "não registrado"}`,
    ];
    info.forEach((l, i) => page.drawText(safe(font, l), { x: M + 260, y: top - 26 - i * 14, size: 8.5, font }));
    y = top - boxH - 12;
  }

  y -= 6;
  text(
    "Assinatura eletrônica simples (art. 4º, I, da Lei 14.063/2020): cada assinatura foi desenhada pela própria pessoa na plataforma, identificada pelo acesso usado. A integridade do arquivo original pode ser conferida pelo SHA-256 acima.",
    { size: 7.5, color: gray }
  );

  const pdf = Buffer.from(await doc.save());
  return { pdf, originalHash, mergedOriginal };
}
