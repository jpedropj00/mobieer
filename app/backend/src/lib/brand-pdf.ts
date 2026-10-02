/**
 * Padrão visual dos documentos da Mobieer (orçamento, contrato, recibo,
 * vistoria, certificado de garantia), tirado do "Manual de uso e certificado
 * de garantia" da loja: papel claro, laranja queimado, título em duas cores com
 * um traço curto embaixo, faixa escura com a marca e contatos no rodapé.
 */
import PDFDocument from "pdfkit";

export const BRAND = {
  paper: "#F8F4EF",
  ink: "#1B1B1B",
  orange: "#C8551F",
  muted: "#6E6761",
  line: "#E4DACF",
  band: "#141414",
  soft: "#F1E9E0",
  tagline: "PLANEJADOS   |   CASA COM A SUA CASA",
  contacts: ["(85) 99637-9339", "@mobieer", "www.mobieer.com.br"],
};

export const PAGE = { left: 56, right: 56, top: 88, bottom: 76, bandHeight: 60 };

type Doc = InstanceType<typeof PDFDocument>;

/** Fundo, faixa da marca e rodapé de uma página. Não mexe no cursor do texto. */
function decorate(doc: Doc, pageNumber: number, contacts: string[]) {
  const { width, height } = doc.page;
  const x = doc.x;
  const y = doc.y;
  // o rodapé fica abaixo da margem: sem zerar, o pdfkit abriria outra página
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();

  doc.rect(0, 0, width, height).fill(BRAND.paper);
  doc.rect(0, 0, width, PAGE.bandHeight).fill(BRAND.band);

  // MØBIEER: o Ø em laranja, como na marca
  doc.font("Helvetica").fontSize(21);
  const opt = { characterSpacing: 3.2, lineBreak: false } as const;
  let wx = PAGE.left;
  const wy = 18;
  for (const [part, color] of [["M", "#FFFFFF"], ["Ø", BRAND.orange], ["BIEER", "#FFFFFF"]] as const) {
    doc.fillColor(color).text(part, wx, wy, opt);
    wx += doc.widthOfString(part, opt);
  }
  doc.font("Helvetica").fontSize(6.5).fillColor("#CFC8C0");
  const tagW = doc.widthOfString(BRAND.tagline, { characterSpacing: 1.6 });
  doc.text(BRAND.tagline, width - PAGE.right - tagW, 27, { characterSpacing: 1.6, lineBreak: false });

  const fy = height - 56;
  doc.moveTo(PAGE.left, fy).lineTo(width - PAGE.right, fy).lineWidth(0.6).strokeColor(BRAND.line).stroke();
  doc.moveTo(PAGE.left, fy).lineTo(PAGE.left + 36, fy).lineWidth(1.4).strokeColor(BRAND.orange).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(BRAND.muted);
  doc.text(contacts.join("   ·   "), PAGE.left, fy + 6, { lineBreak: false });
  const pn = `Página ${pageNumber}`;
  doc.text(pn, width - PAGE.right - doc.widthOfString(pn), fy + 6, { lineBreak: false });

  doc.restore();
  doc.page.margins.bottom = bottom;
  doc.x = x;
  doc.y = y;
  doc.fillColor(BRAND.ink).strokeColor(BRAND.ink);
}

/** Documento A4 já com o padrão em todas as páginas. `done` resolve com o PDF. */
export function brandDocument(opts: { contacts?: string[] } = {}) {
  const doc = new PDFDocument({ size: "A4", margins: { top: PAGE.top, bottom: PAGE.bottom, left: PAGE.left, right: PAGE.right } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const contacts = opts.contacts?.length ? opts.contacts : BRAND.contacts;
  let page = 1;
  decorate(doc, page, contacts);
  doc.on("pageAdded", () => {
    page++;
    decorate(doc, page, contacts);
    doc.y = PAGE.top;
  });
  doc.y = PAGE.top;
  return { doc, done, width: doc.page.width - PAGE.left - PAGE.right };
}

/** Título em duas cores (primeira palavra em laranja) com o traço curto embaixo. */
export function brandTitle(doc: Doc, title: string, subtitle?: string | null) {
  const t = title.trim();
  const cut = t.indexOf(" ");
  const first = cut > 0 ? t.slice(0, cut) : t;
  const rest = cut > 0 ? t.slice(cut) : "";
  doc.font("Times-Roman").fontSize(23).fillColor(BRAND.orange).text(first, PAGE.left, doc.y, { continued: Boolean(rest) });
  if (rest) doc.fillColor(BRAND.ink).text(rest);
  const y = doc.y + 4;
  doc.moveTo(PAGE.left, y).lineTo(PAGE.left + 44, y).lineWidth(1.6).strokeColor(BRAND.orange).stroke();
  doc.y = y + 10;
  if (subtitle) {
    doc.font("Helvetica").fontSize(9).fillColor(BRAND.muted).text(subtitle, PAGE.left, doc.y);
    doc.moveDown(0.4);
  }
  doc.fillColor(BRAND.ink).strokeColor(BRAND.ink);
  doc.moveDown(0.2);
}

/** Rótulo de seção: laranja, maiúsculas, espaçado. */
export function brandSection(doc: Doc, label: string) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND.orange).text(label.toUpperCase(), PAGE.left, doc.y, { characterSpacing: 0.8 });
  doc.fillColor(BRAND.ink);
  doc.moveDown(0.35);
}

/** "Rótulo: valor" com o rótulo em negrito. */
export function brandField(doc: Doc, label: string, value: string, opts: { size?: number } = {}) {
  const size = opts.size ?? 10;
  doc.font("Helvetica-Bold").fontSize(size).fillColor(BRAND.ink).text(`${label}: `, PAGE.left, doc.y, { continued: true, lineGap: 1.5 });
  doc.font("Helvetica").text(value, { lineGap: 1.5 });
}

/** Garante espaço na página; se não couber, abre outra. */
export function ensureSpace(doc: Doc, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}
