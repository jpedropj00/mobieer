/**
 * PDF do orçamento para o cliente: o visual da marca (faixa escura com
 * MØBIEER, papel claro, laranja) com as informações do orçamento da loja —
 * dados da venda e do cliente, ambientes com valor, acabamentos (corpo, porta,
 * puxador, complemento, modelo), descrição por ambiente, condição de pagamento,
 * prazo, validade, as observações fixas e a assinatura de quem vendeu.
 * Custo, mark-up, comissões e resultado nunca entram aqui.
 */
import { BRAND, PAGE, brandDocument, brandSection, brandTitle, ensureSpace } from "../../lib/brand-pdf";
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

const brl = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brDate = (d: Date | null) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "");

export function quoteModelPdf(d: QuotePdfData): Promise<Buffer> {
  const contacts = [d.company.city, d.company.site, d.company.email].filter((x): x is string => Boolean(x));
  const { doc, done, width: W } = brandDocument({ contacts: contacts.length ? contacts : undefined });
  const L = PAGE.left;
  const R = L + W;

  /** Uma linha só: o que não couber na coluna é cortado. */
  const one = (s: string, x: number, y: number, w: number, o: { size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {}) => {
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 8.5).fillColor(o.color ?? BRAND.ink);
    let t = s.replace(/\s+/g, " ").trim();
    while (t.length > 1 && doc.widthOfString(t) > w) t = t.slice(0, -1);
    const tw = doc.widthOfString(t);
    doc.text(t, o.align === "right" ? x + w - tw : o.align === "center" ? x + (w - tw) / 2 : x, y, { lineBreak: false });
    doc.fillColor(BRAND.ink);
  };

  brandTitle(doc, `Orçamento ${d.number}${d.version > 1 ? ` · versão ${d.version}` : ""}`, `Emitido em ${brDate(d.issuedAt)}${d.validUntil ? `   ·   Válido até ${brDate(d.validUntil)}` : ""}`);

  // ---------------------------------------------------------------- venda e cliente (rótulo pequeno em cima, valor embaixo)
  const fields = (rows: [string, string | null | undefined, number][][]) => {
    for (const row of rows) {
      const y = doc.y;
      let x = L;
      for (const [label, value, share] of row) {
        const w = W * share;
        one(label.toUpperCase(), x, y, w - 8, { size: 6.5, color: BRAND.muted });
        one(value?.trim() || "—", x, y + 9, w - 8, { size: 9.5 });
        x += w;
      }
      doc.y = y + 26;
    }
    doc.x = L;
  };
  brandSection(doc, "Dados da venda");
  fields([[["Responsável pela venda", d.seller.name, 0.5], ["Loja", d.store, 0.25], ["Data do orçamento", brDate(d.issuedAt), 0.25]]]);
  doc.moveDown(0.3);
  brandSection(doc, "Dados do cliente");
  fields([
    [["Cliente", d.client.name, 0.6], ["Telefone", d.client.phone, 0.4]],
    [["Endereço", d.client.address, 0.6], ["E-mail", d.client.email, 0.4]],
    [["Bairro", d.client.district, 0.3], ["Cidade", d.client.city, 0.3], ["UF", d.client.state, 0.15], ["CEP", d.client.zipCode, 0.25]],
  ]);
  doc.moveDown(0.4);

  // ---------------------------------------------------------------- tabela: cabeçalho escuro, linhas com fio claro
  type Col = { label: string; w: number; align?: "left" | "center" | "right"; size?: number; bold?: boolean };
  const table = (cols: Col[], data: string[][], minRowH: number, wrap = false) => {
    const xs = cols.reduce<number[]>((acc, c, i) => [...acc, i === 0 ? L : acc[i - 1] + cols[i - 1].w * W], []);
    const header = () => {
      const y = doc.y;
      doc.rect(L, y, W, 18).fill(BRAND.band);
      cols.forEach((c, i) => one(c.label, xs[i] + 6, y + 6, c.w * W - 12, { size: 7, bold: true, color: "#FFFFFF", align: c.align }));
      doc.y = y + 18;
    };
    ensureSpace(doc, 18 + minRowH);
    header();
    for (const row of data) {
      // com quebra de linha, nada é cortado: a linha cresce com o texto
      const rowH = wrap
        ? Math.max(minRowH, ...cols.map((c, i) => doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fontSize(c.size ?? 8.5).heightOfString(row[i] ?? "", { width: c.w * W - 12 }) + 8))
        : minRowH;
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      cols.forEach((c, i) => {
        if (!wrap) return one(row[i] ?? "", xs[i] + 6, y + (rowH - (c.size ?? 8.5)) / 2, c.w * W - 12, { size: c.size, bold: c.bold, align: c.align });
        doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fontSize(c.size ?? 8.5).fillColor(BRAND.ink).text(row[i] ?? "", xs[i] + 6, y + 4.5, { width: c.w * W - 12, align: c.align ?? "left" });
      });
      doc.moveTo(L, y + rowH).lineTo(R, y + rowH).strokeColor(BRAND.line).lineWidth(0.5).stroke();
      doc.y = y + rowH;
    }
    doc.x = L;
  };

  // ---------------------------------------------------------------- ambientes
  const codes = d.items.map((_, i) => ambCode(i));
  brandSection(doc, "Ambientes");
  table(
    [
      { label: "AMB", w: 0.06, align: "center", bold: true },
      { label: "QTD", w: 0.07, align: "center" },
      { label: "AMBIENTE", w: 0.22, size: 9.5, bold: true },
      { label: "FORNECEDOR", w: 0.25, size: 6.5 },
      { label: "LINHA", w: 0.14, size: 7 },
      { label: "PRAZO", w: 0.1, align: "center", size: 7.5 },
      { label: "VALOR", w: 0.16, align: "right", size: 9.5 },
    ],
    d.items.map((it, i) => [codes[i], it.quantity.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), it.room || it.description, d.config.supplier, d.config.line, `${d.config.deliveryDays} dias`, brl(it.total)]),
    20
  );
  ensureSpace(doc, 70);
  doc.y += 6;
  if (d.discount > 0) {
    for (const [k, v] of [["Total dos ambientes", brl(d.subtotal)], ["Desconto", `- ${brl(d.discount)}`]]) {
      one(k, R - 250, doc.y, 150, { color: BRAND.muted, align: "right" });
      one(v, R - 96, doc.y, 90, { align: "right" });
      doc.y += 14;
    }
  }
  const ty = doc.y + 2;
  doc.roundedRect(R - 250, ty, 250, 30, 4).fill(BRAND.soft);
  one(d.discount > 0 ? "VALOR FINAL" : "TOTAL DOS AMBIENTES", R - 238, ty + 11, 130, { size: 8, bold: true, color: BRAND.muted });
  one(brl(d.total), R - 150, ty + 8, 142, { size: 14, bold: true, color: BRAND.orange, align: "right" });
  doc.x = L;
  doc.y = ty + 44;

  // ---------------------------------------------------------------- acabamentos
  ensureSpace(doc, 60);
  brandSection(doc, "Acabamentos");
  table(
    [
      { label: "AMB", w: 0.07, align: "center", bold: true },
      { label: "CORPO", w: 0.24, size: 7.5 },
      { label: "PORTA", w: 0.27, size: 7.5 },
      { label: "PUXADOR", w: 0.16, size: 7.5 },
      { label: "COMPLEMENTO", w: 0.14, size: 7.5 },
      { label: "MODELO", w: 0.12, size: 7.5 },
    ],
    d.items.map((it, i) => [codes[i], it.corpo ?? "", it.porta ?? "", it.puxador ?? "", it.complemento ?? "", it.modelo ?? ""]),
    17,
    true
  );
  doc.y += 14;

  // ---------------------------------------------------------------- descrição por ambiente
  ensureSpace(doc, 60);
  brandSection(doc, "Descrição por ambiente");
  d.items.forEach((it, i) => {
    doc.font("Helvetica").fontSize(8.5);
    const h = doc.heightOfString(it.description, { width: W - 34, lineGap: 1.5 });
    ensureSpace(doc, Math.min(h, 120) + 24);
    const y = doc.y;
    one(codes[i], L, y, 26, { size: 9, bold: true, color: BRAND.orange });
    one(it.room || "", L + 34, y, W - 34, { size: 9, bold: true });
    doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.ink).text(it.description, L + 34, y + 12, { width: W - 34, lineGap: 1.5 });
    doc.x = L;
    doc.y += 5;
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(BRAND.line).lineWidth(0.5).stroke();
    doc.y += 6;
  });
  doc.y += 6;

  // ---------------------------------------------------------------- condições
  ensureSpace(doc, 62);
  brandSection(doc, "Condições");
  const days = d.issuedAt && d.validUntil ? Math.max(1, Math.round((d.validUntil.getTime() - d.issuedAt.getTime()) / 86_400_000)) : null;
  one("CONDIÇÃO DE PAGAMENTO", L, doc.y, W, { size: 6.5, color: BRAND.muted });
  doc.font("Helvetica").fontSize(9.5).fillColor(BRAND.ink).text(d.payment.trim() || "—", L, doc.y + 9, { width: W, lineGap: 1.5 });
  doc.x = L;
  doc.y += 7;
  fields([[["Prazo de entrega", d.config.deliveryText, 0.55], ["Validade da proposta", days ? `${days} dias (até ${brDate(d.validUntil)})` : "", 0.45]]]);
  doc.moveDown(0.4);

  // ---------------------------------------------------------------- observações fixas
  const notes = [...d.config.notes, ...(d.notes?.trim() ? [d.notes.trim()] : [])];
  if (notes.length) {
    ensureSpace(doc, 50);
    brandSection(doc, "Observações");
    notes.forEach((n, i) => {
      doc.font("Helvetica").fontSize(8);
      const h = doc.heightOfString(n, { width: W - 40 });
      ensureSpace(doc, h + 6);
      const y = doc.y;
      one(obsLabel(i), L, y, 36, { size: 8, bold: true, color: BRAND.orange });
      doc.font("Helvetica").fontSize(8).fillColor(BRAND.ink).text(n, L + 40, y, { width: W - 40 });
      doc.x = L;
      doc.y += 4;
    });
  }

  // ---------------------------------------------------------------- assinatura
  ensureSpace(doc, 82);
  const sy = doc.y + 14;
  const sx = L + W / 2 - 110;
  if (d.seller.signatureImage?.startsWith("data:image/png;base64,")) {
    try {
      doc.image(Buffer.from(d.seller.signatureImage.split(",")[1], "base64"), sx + 35, sy, { fit: [150, 40] });
    } catch {
      /* imagem inválida: fica só a linha */
    }
  }
  doc.moveTo(sx, sy + 44).lineTo(sx + 220, sy + 44).strokeColor(BRAND.ink).lineWidth(0.7).stroke();
  one(d.seller.name, sx, sy + 49, 220, { size: 9, bold: true, align: "center" });
  one("Responsável pela venda", sx, sy + 61, 220, { size: 8, color: BRAND.muted, align: "center" });

  doc.end();
  return done;
}
