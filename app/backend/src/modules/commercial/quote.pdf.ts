/**
 * PDF do orçamento no modelo da loja: cabeçalho com o logotipo, dados da venda
 * e do cliente, ambientes com valor, acabamentos (corpo, porta, puxador,
 * complemento, modelo), observação por ambiente, condição de pagamento, as
 * observações fixas e a assinatura do responsável pela venda.
 * Custo, mark-up, comissões e resultado nunca entram aqui.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { ambCode, obsLabel, type QuoteDocumentConfig } from "./quote.rules";

export type QuotePdfData = {
  number: string;
  version: number;
  issuedAt: Date | null;
  validUntil: Date | null;
  seller: { name: string; signatureImage?: string | null };
  store: string;
  company: { name: string; city: string | null; site: string | null; email: string | null };
  client: { name: string; address: string | null; district: string | null; city: string | null; state: string | null; zipCode: string | null; phone: string | null; email: string | null };
  items: { room: string | null; description: string; quantity: number; total: number; corpo: string | null; porta: string | null; puxador: string | null; complemento: string | null; modelo: string | null }[];
  subtotal: number;
  discount: number;
  total: number;
  payment: string;
  notes: string | null;
  config: QuoteDocumentConfig;
};

const L = 35;
const R = 560;
const W = R - L;
const FRAME = { x: 28, y: 26, w: 540, h: 790 };
const BOTTOM = FRAME.y + FRAME.h - 6;
const GRAY = "#D9D9D9";

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brDate = (d: Date | null) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "");
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

function logoPath() {
  const candidates = [path.join(process.cwd(), "assets", "orcamento", "logo.png"), path.join(__dirname, "..", "..", "..", "assets", "orcamento", "logo.png"), path.join(__dirname, "..", "..", "..", "..", "assets", "orcamento", "logo.png")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function quoteModelPdf(d: QuotePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 28, left: L, right: 595 - R } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const frame = () => doc.lineWidth(0.8).strokeColor("#000").rect(FRAME.x, FRAME.y, FRAME.w, FRAME.h).stroke();
  frame();
  doc.on("pageAdded", () => {
    frame();
    doc.y = 40;
  });

  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.6) => doc.lineWidth(w).strokeColor("#000").moveTo(x1, y1).lineTo(x2, y2).stroke();
  const box = (x: number, y: number, w: number, h: number, fill?: string) => {
    if (fill) doc.rect(x, y, w, h).fill(fill);
    doc.lineWidth(0.6).strokeColor("#000").rect(x, y, w, h).stroke();
    doc.fillColor("#000");
  };
  /** Uma linha só: o que não couber na coluna é cortado, como no modelo. */
  const text = (s: string, x: number, y: number, w: number, o: { size?: number; bold?: boolean; align?: "left" | "center" | "right" } = {}) => {
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 7).fillColor("#000");
    let t = s.replace(/\s+/g, " ").trim();
    while (t.length > 1 && doc.widthOfString(t) > w) t = t.slice(0, -1);
    const tw = doc.widthOfString(t);
    doc.text(t, o.align === "right" ? x + w - tw : o.align === "center" ? x + (w - tw) / 2 : x, y, { lineBreak: false });
  };
  const need = (h: number) => {
    if (doc.y + h > BOTTOM) doc.addPage();
  };

  // ---------------------------------------------------------------- cabeçalho
  const hy = FRAME.y;
  const hh = 86;
  line(FRAME.x, hy + hh, FRAME.x + FRAME.w, hy + hh, 0.8);
  line(148, hy, 148, hy + hh, 0.8);
  line(420, hy, 420, hy + hh, 0.8);
  const logo = logoPath();
  if (logo) doc.image(logo, 40, hy + 14, { fit: [98, 60], align: "center", valign: "center" });
  else text("MOBIEER", 34, hy + 36, 110, { size: 15, bold: true, align: "center" });
  const head = [d.company.name.toUpperCase(), d.company.city ?? "", d.company.site ?? "", (d.company.email ?? "").toUpperCase()].filter(Boolean);
  head.forEach((t, i) => text(t, 150, hy + 22 + i * 13, 268, { size: i === 0 || i === head.length - 1 ? 7 : 8, align: "center" }));
  text(`Nº ${d.number}${d.version > 1 ? ` · v${d.version}` : ""}`, 424, hy + 36, 140, { size: 9, bold: true, align: "center" });

  // ---------------------------------------------------------------- dados
  let y = hy + hh + 6;
  const cell = (label: string, value: string, x: number, w: number, yy: number) => {
    text(label, x + 3, yy + 4, w - 6, { bold: true });
    text(value, x + 3, yy + 15, w - 6);
  };
  const rows: { h: number; cells: [string, string, number][] }[] = [
    { h: 26, cells: [["Responsável pela venda", up(d.seller.name), L], ["LOJA", up(d.store), 276], ["DATA DO ORÇAMENTO", brDate(d.issuedAt), 432]] },
    { h: 26, cells: [["CLIENTE", up(d.client.name), L]] },
    { h: 26, cells: [["ENDEREÇO", up(d.client.address), L]] },
    { h: 26, cells: [["BAIRRO", up(d.client.district), L], ["CIDADE", up(d.client.city), 205], ["UF", up(d.client.state), 368], ["CEP", d.client.zipCode ?? "", 432]] },
    { h: 26, cells: [["TELEFONE", d.client.phone ?? "", L], ["E-MAIL", up(d.client.email), 205]] },
  ];
  for (const r of rows) {
    box(L, y, W, r.h);
    r.cells.forEach(([label, value, x], i) => {
      const next = r.cells[i + 1]?.[2] ?? R;
      if (i > 0) line(x, y, x, y + r.h);
      cell(label, value, x, next - x, y);
    });
    y += r.h;
  }
  y += 10;

  // tabela genérica: cabeçalho cinza e linhas de altura fixa
  type Col = { label: string; x: number; align?: "left" | "center" | "right"; size?: number };
  const table = (cols: Col[], data: string[][], rowH: number) => {
    const header = () => {
      box(L, y, W, 14, GRAY);
      cols.forEach((c, i) => {
        const w = (cols[i + 1]?.x ?? R) - c.x;
        if (i > 0) line(c.x, y, c.x, y + 14);
        text(c.label, c.x + 3, y + 4, w - 6, { bold: true, align: c.align === "right" ? "right" : i === 0 ? "center" : "left" });
      });
      y += 14;
    };
    doc.y = y;
    need(14 + rowH);
    y = doc.y;
    header();
    for (const row of data) {
      if (y + rowH > BOTTOM) {
        doc.addPage();
        y = doc.y;
        header();
      }
      box(L, y, W, rowH);
      cols.forEach((c, i) => {
        const w = (cols[i + 1]?.x ?? R) - c.x;
        if (i > 0) line(c.x, y, c.x, y + rowH);
        const size = c.size ?? 7;
        text(row[i] ?? "", c.x + 3, y + (rowH - size) / 2 + 0.5, w - 6, { size, align: c.align ?? "left" });
      });
      y += rowH;
    }
  };

  // ---------------------------------------------------------------- ambientes
  const codes = d.items.map((_, i) => ambCode(i));
  table(
    [
      { label: "AMB", x: L, align: "center" },
      { label: "QTD", x: 60, align: "center" },
      { label: "AMBIENTES", x: 84, size: 10 },
      { label: "FORNECEDOR", x: 236, size: 8 },
      { label: "LINHA", x: 360, size: 8 },
      { label: "PRAZO", x: 455, align: "center", size: 8 },
      { label: "VALOR", x: 492, align: "right", size: 10 },
    ],
    d.items.map((it, i) => [codes[i], it.quantity.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), up(it.room || it.description), up(d.config.supplier), up(d.config.line), String(d.config.deliveryDays), brl(it.total)]),
    16
  );
  const totalRow = (label: string, value: string, bold = true) => {
    box(L, y, W, 16);
    text(label, 300, y + 4, 180, { size: 9, bold, align: "right" });
    text(value, 484, y + 3.5, 73, { size: 10, bold, align: "right" });
    y += 16;
  };
  if (d.discount > 0) {
    totalRow("Total dos Ambientes", brl(d.subtotal), false);
    totalRow("Desconto", `- ${brl(d.discount)}`, false);
    totalRow("Valor final", brl(d.total));
  } else totalRow("Total dos Ambientes", brl(d.total));
  y += 8;

  // ---------------------------------------------------------------- acabamentos
  table(
    [
      { label: "AMB", x: L, align: "center" },
      { label: "CORPO", x: 63 },
      { label: "PORTA", x: 190 },
      { label: "PUXADOR", x: 346 },
      { label: "COMPLEMENTO", x: 418 },
      { label: "MODELO", x: 505 },
    ],
    d.items.map((it, i) => [codes[i], up(it.corpo), up(it.porta), up(it.puxador), up(it.complemento), up(it.modelo)]),
    14
  );
  y += 8;

  // ---------------------------------------------------------------- observação por ambiente
  const obsX = 70;
  const obsHeader = () => {
    box(L, y, W, 15, GRAY);
    line(obsX, y, obsX, y + 15);
    text("AMB", L, y + 4, obsX - L, { size: 8, bold: true, align: "center" });
    text("OBSERVAÇÃO", obsX + 6, y + 4, 200, { size: 8, bold: true });
    y += 15;
  };
  doc.y = y;
  need(45);
  y = doc.y;
  obsHeader();
  d.items.forEach((it, i) => {
    const body = up(it.description);
    doc.font("Helvetica").fontSize(7);
    const h = Math.max(22, doc.heightOfString(body, { width: R - obsX - 14, lineGap: 1 }) + 14);
    if (y + h > BOTTOM) {
      doc.addPage();
      y = doc.y;
      obsHeader();
    }
    box(L, y, W, h);
    line(obsX, y, obsX, y + h);
    text(codes[i], L, y + 4, obsX - L, { align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor("#000").text(body, obsX + 8, y + 8, { width: R - obsX - 14, lineGap: 1 });
    y += h;
  });

  // ---------------------------------------------------------------- pagamento, prazo e validade
  doc.y = y;
  need(34);
  y = doc.y;
  const days = d.issuedAt && d.validUntil ? Math.max(1, Math.round((d.validUntil.getTime() - d.issuedAt.getTime()) / 86_400_000)) : null;
  const pay: [string, string, number][] = [
    ["CONDIÇÃO DE PAGAMENTO", up(d.payment), L],
    ["PRAZO ENTREGA", d.config.deliveryText, 208],
    ["VALIDADE DA PROPOSTA", days ? `${days} DIAS (ATÉ ${brDate(d.validUntil)})` : "", 361],
  ];
  box(L, y, W, 13, GRAY);
  box(L, y + 13, W, 15);
  pay.forEach(([label, value, x], i) => {
    const w = (pay[i + 1]?.[2] ?? R) - x;
    if (i > 0) line(x, y, x, y + 28);
    text(label, x + 3, y + 3.5, w - 6, { bold: true });
    text(value, x + 3, y + 17.5, w - 6, { bold: i === 2 });
  });
  y += 28 + 16;

  // ---------------------------------------------------------------- observações fixas
  const notes = [...d.config.notes, ...(d.notes?.trim() ? [d.notes.trim()] : [])];
  notes.forEach((n, i) => {
    const s = `${obsLabel(i)} ${n}`;
    doc.font("Helvetica").fontSize(8);
    const h = doc.heightOfString(s, { width: W - 4 }) + 5;
    doc.y = y;
    need(h);
    y = doc.y;
    doc.fillColor("#000").text(s, L + 2, y, { width: W - 4 });
    y += h;
  });

  // ---------------------------------------------------------------- assinatura
  doc.y = y;
  need(56);
  y = doc.y + 6;
  const sx = 205;
  const sw = R - sx - 10;
  if (d.seller.signatureImage?.startsWith("data:image/png;base64,")) {
    try {
      doc.image(Buffer.from(d.seller.signatureImage.split(",")[1], "base64"), sx + sw / 2 - 80, y, { fit: [150, 38] });
    } catch {
      /* imagem inválida: fica só a linha */
    }
  }
  line(sx, y + 40, sx + sw, y + 40, 0.8);
  text("Responsável pela venda", sx, y + 45, sw, { align: "center" });

  doc.end();
  return done;
}
