/**
 * PDF das etiquetas da produção (código de barras Code 128) e reserva de códigos.
 */
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { labelLayout, nextCodes, type LabelFormat } from "./labels.rules";

/** Reserva `n` códigos novos para a organização. */
export async function allocateCodes(organizationId: string, n: number, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const last = await tx.productionItem.findFirst({ where: { organizationId, code: { not: null } }, orderBy: { code: "desc" }, select: { code: true } });
  return nextCodes(last?.code, n);
}

/** Itens antigos (ou criados sem código) recebem um agora, para poderem ser etiquetados. */
export async function ensureCodes(organizationId: string, orderId: string) {
  const missing = await prisma.productionItem.findMany({ where: { orderId, code: null }, select: { id: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  if (!missing.length) return 0;
  const codes = await allocateCodes(organizationId, missing.length);
  await prisma.$transaction(missing.map((m, i) => prisma.productionItem.update({ where: { id: m.id }, data: { code: codes[i] } })));
  return missing.length;
}

export type LabelItem = {
  code: string;
  descricao: string;
  ambiente: string | null;
  modulo: string | null;
  medidas: string | null;
  material: string | null;
  fita: string | null;
  quantidade: number;
  position: number;
};

const barcode = (text: string) => bwipjs.toBuffer({ bcid: "code128", text, scale: 3, height: 9, includetext: false, paddingwidth: 0, paddingheight: 0 });

export async function labelsPdf(opts: { projectCode: string; client: string | null; items: LabelItem[]; format: LabelFormat }): Promise<Buffer> {
  const layout = labelLayout(opts.format);
  const bars = await Promise.all(opts.items.map((i) => barcode(i.code)));

  const doc = new PDFDocument({ size: layout.page, margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const big = opts.format === "termica";
  const f = (n: number) => (big ? n * 1.3 : n);
  const one = (text: string, x: number, y: number, w: number, size: number, bold = false, lines = 1) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor("#000");
    doc.text(text, x, y, { width: w, height: size * 1.18 * lines, ellipsis: true, lineBreak: lines > 1, lineGap: 0 });
  };

  opts.items.forEach((it, idx) => {
    const slot = idx % layout.perPage;
    if (slot === 0) doc.addPage({ size: layout.page, margin: 0 });
    const c = layout.cells[slot];
    const x = c.x + layout.pad;
    const w = c.w - layout.pad * 2;
    let y = c.y + layout.pad;

    one(`${opts.projectCode}${opts.client ? ` · ${opts.client}` : ""}`, x, y, w - 34, f(6.5));
    one(`${it.position}/${opts.items.length}`, x + w - 34, y, 34, f(6.5));
    doc.text("", x, y); // mantém o cursor previsível
    y += f(9);
    one(it.descricao, x, y, w, f(8.5), true, 2);
    y += f(8.5) * 1.18 * 2 + 1;
    const where = [it.ambiente, it.modulo].filter(Boolean).join(" · ");
    if (where) {
      one(where, x, y, w, f(6.5));
      y += f(8);
    }
    const spec = [it.medidas, it.material].filter(Boolean).join(" · ");
    if (spec) {
      one(spec, x, y, w, f(6.5));
      y += f(8);
    }
    if (it.fita) one(`Fita: ${it.fita}`, x, y, w, f(6.5));

    // código de barras no pé da etiqueta, com o número legível e a quantidade
    const bh = big ? 34 : 22;
    const by = c.y + c.h - layout.pad - bh - f(8);
    const bw = Math.min(w - 44, big ? 170 : 120);
    doc.image(bars[idx], x, by, { width: bw, height: bh });
    one(it.code, x, by + bh + 1.5, bw, f(6.5));
    one(`Qtd ${it.quantidade}`, x + w - 40, by + bh - f(8), 40, f(8), true);
  });

  if (!opts.items.length) doc.addPage({ size: layout.page, margin: 0 });
  doc.end();
  return done;
}
