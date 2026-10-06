/**
 * PDF do termo de entrega no padrão da loja: página 1 "Preparando o ambiente",
 * página 2 "Autorização de produção" com a relação de ambientes, os prazos e
 * os campos de assinatura.
 */
import { BRAND, PAGE, brandDocument, brandSection, brandTitle, ensureSpace } from "../../lib/brand-pdf";
import { AUTHORIZATION_TEXT, PREPARING_ITEMS, attentionText, authorizationIntro, brDay, formatDocument, longDate, type DeliveryTermData } from "./delivery-term.rules";

export type DeliveryTermPdfInput = DeliveryTermData & { client: { name: string; document: string | null } };

export function deliveryTermPdf(d: DeliveryTermPdfInput): Promise<Buffer> {
  const { doc, done, width: W } = brandDocument();
  const L = PAGE.left;

  // ---------------------------------------------------------------- preparando o ambiente
  brandTitle(doc, "Preparando o ambiente", null, { size: 18 });
  for (const item of PREPARING_ITEMS) {
    doc.font("Helvetica").fontSize(9.5);
    ensureSpace(doc, doc.heightOfString(item, { width: W - 14, lineGap: 1.5 }) + 7);
    const y = doc.y;
    doc.circle(L + 3, y + 4.5, 1.6).fill(BRAND.orange);
    doc.fillColor(BRAND.ink).text(item, L + 14, y, { width: W - 14, lineGap: 1.5, align: "justify" });
    doc.x = L;
    doc.y += 6;
  }
  doc.y += 4;
  const attention = attentionText(d.deliveryDays);
  doc.font("Helvetica-Bold").fontSize(9.5);
  ensureSpace(doc, doc.heightOfString(attention, { width: W, lineGap: 1.5 }) + 6);
  doc.fillColor(BRAND.ink).text(attention, L, doc.y, { width: W, lineGap: 1.5, align: "justify" });

  // ---------------------------------------------------------------- autorização de produção
  doc.addPage();
  brandTitle(doc, "Autorização de produção", null, { size: 18 });
  doc.font("Helvetica").fontSize(10).fillColor(BRAND.ink).text(authorizationIntro(d.contractNumber), L, doc.y, { width: W, lineGap: 2, align: "justify" });
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").text("Cliente: ", L, doc.y, { continued: true }).font("Helvetica").text(d.client.name);
  const cpf = formatDocument(d.client.document);
  doc.font("Helvetica-Bold").text(cpf.replace(/\D/g, "").length === 14 ? "CNPJ: " : "CPF: ", L, doc.y, { continued: true }).font("Helvetica").text(cpf || "____________________");
  doc.moveDown(0.6);
  doc.text(AUTHORIZATION_TEXT, L, doc.y, { width: W, lineGap: 2, align: "justify" });
  doc.moveDown(1);

  brandSection(doc, "Relação");
  const cols = [0.24, 0.14, 0.62];
  const row = (cells: string[], header = false) => {
    const y = doc.y;
    if (header) doc.rect(L, y, W, 18).fill(BRAND.band);
    let x = L;
    cells.forEach((c, i) => {
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(header ? 7.5 : 9.5).fillColor(header ? "#FFFFFF" : BRAND.ink).text(c, x + 8, y + (header ? 6 : 5), { width: cols[i] * W - 16, lineBreak: false });
      x += cols[i] * W;
    });
    if (!header) doc.moveTo(L, y + 20).lineTo(L + W, y + 20).strokeColor(BRAND.line).lineWidth(0.5).stroke();
    doc.x = L;
    doc.y = y + (header ? 18 : 20);
  };
  row(["DATA", "ITEM", "AMBIENTES"], true);
  d.rooms.forEach((r, i) => {
    if (doc.y + 22 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      row(["DATA", "ITEM", "AMBIENTES"], true);
    }
    row([brDay(r.date), String(i + 1).padStart(2, "0"), r.room.toUpperCase()]);
  });
  if (!d.rooms.length) row(["____/____/______", "01", ""]);
  doc.moveDown(1.2);

  for (const dl of d.deadlines.filter((x) => x.label.trim())) {
    ensureSpace(doc, 18);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND.ink).text(`${dl.label.trim().toUpperCase()}: `, L, doc.y, { continued: true }).font("Helvetica").text(brDay(dl.date));
    doc.moveDown(0.3);
  }

  // ---------------------------------------------------------------- data e assinaturas
  ensureSpace(doc, 190);
  doc.moveDown(1.4);
  doc.font("Helvetica").fontSize(10).text(longDate(d.city, d.date), L, doc.y);
  const sign = (label: string, y: number) => {
    const x = L + W / 2 - 120;
    doc.moveTo(x, y).lineTo(x + 240, y).strokeColor(BRAND.ink).lineWidth(0.6).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.muted).text(label, x, y + 4, { width: 240, align: "center" });
    doc.fillColor(BRAND.ink);
  };
  const y0 = doc.y + 46;
  sign("(Assinatura do Cliente)", y0);
  sign("(Assinatura do Responsável / Arquiteto)", y0 + 52);
  sign("(Assinatura do Responsável Técnico)", y0 + 104);

  doc.end();
  return done;
}
