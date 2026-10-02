import { BRAND, PAGE, brandDocument, brandField, brandSection, brandTitle, ensureSpace } from "../../lib/brand-pdf";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { brl } from "../templates/contract.service";
import { normalizePricing, paymentText, type PaymentMethod, type PricingConfig, type QuoteCalc } from "./quote.rules";

export const PRICING_SETTING = "commercial.pricing";

export async function loadPricing(): Promise<PricingConfig> {
  const row = await prisma.setting.findUnique({ where: { key: PRICING_SETTING } });
  if (!row) return normalizePricing(null);
  try {
    return normalizePricing(JSON.parse(row.value));
  } catch {
    return normalizePricing(null);
  }
}

export const quoteInclude = {
  client: { select: { id: true, name: true, document: true, phone: true, email: true, address: true } },
  opportunity: { select: { id: true, title: true, status: true } },
  project: { select: { id: true, code: true, name: true } },
  seller: { select: { id: true, name: true } },
  approvalDecidedBy: { select: { id: true, name: true } },
  referrer: { select: { id: true, name: true, kind: true } },
  items: { orderBy: { position: "asc" } },
  commissions: true,
} satisfies Prisma.CommercialQuoteInclude;

type QuoteRow = Prisma.CommercialQuoteGetPayload<{ include: typeof quoteInclude }>;
const n = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export function serializeQuote(q: QuoteRow) {
  const total = n(q.total);
  return {
    id: q.id,
    number: q.number,
    version: q.version,
    status: q.status,
    issuedAt: q.issuedAt,
    validUntil: q.validUntil,
    sentAt: q.sentAt,
    approvedAt: q.approvedAt,
    kind: q.kind,
    futureSale: q.futureSale,
    futureReleaseDate: q.futureReleaseDate,
    parentId: q.parentId,
    competenceDate: q.competenceDate,
    cancelledAt: q.cancelledAt,
    cancelReason: q.cancelReason,
    notes: q.notes,
    paymentTerms: q.paymentTerms,
    client: q.client,
    opportunity: q.opportunity,
    project: q.project,
    seller: q.seller,
    items: q.items.map((i) => ({
      id: i.id,
      room: i.room,
      description: i.description,
      quantity: n(i.quantity),
      unitCost: n(i.unitCost),
      unitPrice: n(i.unitPrice),
      total: n(i.total),
    })),
    commissions: q.commissions.map((c) => ({ id: c.id, userId: c.userId, referrerId: c.referrerId, name: c.name, role: c.role, percent: n(c.percent), amount: n(c.amount) })),
    referrer: q.referrer,
    costTotal: n(q.costTotal),
    markup: n(q.markup),
    commissionPercent: n(q.commissionPercent),
    subtotal: n(q.subtotal),
    discount: n(q.discount),
    total,
    freight: n(q.freight),
    otherCosts: n(q.otherCosts),
    payment: {
      method: q.paymentMethod as PaymentMethod,
      planId: q.financingPlanId,
      planName: q.financingPlanName,
      installments: q.installments,
      downPayment: n(q.downPayment),
      feePercent: n(q.financingFeePercent),
      financingFee: n(q.financingFee),
    },
    netRevenue: n(q.netRevenue),
    result: n(q.result),
    marginPercent: total > 0 ? Math.round((n(q.result) / total) * 10000) / 100 : null,
    score: q.score == null ? null : n(q.score),
    approval: {
      status: q.approvalStatus,
      requestedAt: q.approvalRequestedAt,
      decidedAt: q.approvalDecidedAt,
      decidedBy: q.approvalDecidedBy,
      note: q.approvalNote,
    },
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

/** Campos gravados a partir do cálculo — o mesmo objeto serve para criar e atualizar. */
export function calcToData(c: QuoteCalc) {
  const D = (v: number) => new Prisma.Decimal(v.toFixed(2));
  return {
    costTotal: D(c.costTotal),
    markup: new Prisma.Decimal(c.markup.toFixed(4)),
    commissionPercent: D(c.commissionPercent),
    subtotal: D(c.subtotal),
    discount: D(c.discount),
    total: D(c.total),
    freight: D(c.freight),
    otherCosts: D(c.otherCosts),
    paymentMethod: c.payment.method,
    financingPlanId: c.payment.planId,
    financingPlanName: c.payment.planName,
    installments: c.payment.installments,
    downPayment: D(c.payment.downPayment),
    financingFeePercent: D(c.payment.feePercent),
    financingFee: D(c.payment.financingFee),
    netRevenue: D(c.netRevenue),
    result: D(c.result),
    score: c.score == null ? null : new Prisma.Decimal(c.score.toFixed(4)),
    items: {
      create: c.items.map((i, position) => ({
        position,
        room: i.room,
        description: i.description,
        quantity: new Prisma.Decimal(i.quantity.toFixed(3)),
        unitCost: D(i.unitCost),
        unitPrice: D(i.unitPrice),
        total: D(i.total),
      })),
    },
    commissions: {
      create: c.commissions.map((m) => ({ userId: m.userId, referrerId: m.referrerId, name: m.name, role: m.role, percent: D(m.percent), amount: D(m.amount) })),
    },
  };
}

/** Próximo número ORC-00001 da organização (as versões repetem o número). */
export async function nextQuoteNumber(organizationId: string) {
  const last = await prisma.commercialQuote.findFirst({
    // adendo reaproveita o número do contrato (ORC-00001-A1): não entra na sequência
    where: { organizationId, number: { startsWith: "ORC-" }, kind: "PADRAO" },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const num = last ? parseInt(last.number.replace(/\D/g, ""), 10) + 1 : 1;
  return `ORC-${String(num).padStart(5, "0")}`;
}

const brDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) : "—");

/**
 * PDF do orçamento para o cliente: ambientes e valores de venda, condição de
 * pagamento e a assinatura do responsável pela venda. Custo, mark-up,
 * comissões e resultado nunca entram aqui.
 */
export async function quotePdf(q: ReturnType<typeof serializeQuote>, organizationId: string): Promise<Buffer> {
  const [org, seller] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, include: { enterprise: true } }),
    prisma.user.findUnique({ where: { id: q.seller.id }, select: { name: true, position: true, signatureImage: true } }),
  ]);
  const ent = org?.enterprise;

  const contacts = [ent?.phone, ent?.email].filter((x): x is string => Boolean(x));
  const { doc, done, width: W } = brandDocument({ contacts: contacts.length ? [...contacts, "www.mobieer.com.br"] : undefined });
  const L = PAGE.left;

  brandTitle(
    doc,
    `Orçamento ${q.number}${q.version > 1 ? ` · versão ${q.version}` : ""}`,
    `Emitido em ${brDate(q.issuedAt)}   ·   Válido até ${brDate(q.validUntil)}${ent?.document ? `   ·   ${ent.tradeName ?? ent.legalName} — CNPJ ${ent.document}` : ""}`
  );

  brandSection(doc, "Dados do cliente");
  brandField(doc, "Cliente", q.client.name);
  if (q.client.document) brandField(doc, "CPF / CNPJ", q.client.document);
  const cli = [q.client.phone, q.client.email].filter(Boolean).join("   ·   ");
  if (cli) brandField(doc, "Contato", cli);
  if (q.client.address) brandField(doc, "Endereço", q.client.address);
  if (q.project) brandField(doc, "Projeto", `${q.project.code} — ${q.project.name}`);
  doc.moveDown(0.9);

  // Tabela: ambiente/descrição | qtd | valor
  brandSection(doc, "Ambientes e itens");
  const colQ = L + W - 150;
  const colV = L + W - 96;
  const header = () => {
    const y = doc.y;
    doc.rect(L, y, W, 20).fill(BRAND.band);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
    doc.text("AMBIENTE / ITEM", L + 8, y + 6, { width: colQ - L - 16, characterSpacing: 0.6, lineBreak: false });
    doc.text("QTD", colQ, y + 6, { width: 46, align: "right", lineBreak: false });
    doc.text("VALOR", colV, y + 6, { width: 88, align: "right", lineBreak: false });
    doc.fillColor(BRAND.ink);
    doc.y = y + 26;
  };
  header();
  let room = "";
  for (const it of q.items) {
    const h = Math.max(doc.heightOfString(it.description, { width: colQ - L - 16 }), 11) + 8;
    if (doc.y + h + (it.room && it.room !== room ? 18 : 0) > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    if (it.room && it.room !== room) {
      room = it.room;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(BRAND.orange).text(room, L + 8, doc.y, { width: W - 16 });
      doc.fillColor(BRAND.ink);
      doc.y += 3;
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5);
    doc.text(it.description, L + 8, y, { width: colQ - L - 16 });
    doc.text(String(it.quantity).replace(".", ","), colQ, y, { width: 46, align: "right" });
    doc.text(brl(it.total), colV, y, { width: 88, align: "right" });
    doc.y = y + h;
    doc.moveTo(L, doc.y - 4).lineTo(L + W, doc.y - 4).strokeColor(BRAND.line).lineWidth(0.5).stroke();
  }

  // Totais
  ensureSpace(doc, 70);
  doc.moveDown(0.4);
  const line = (k: string, v: string) => {
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(BRAND.muted).text(k, colQ - 110, y, { width: 160, align: "right" });
    doc.fillColor(BRAND.ink).text(v, colV, y, { width: 88, align: "right" });
    doc.y = y + 15;
  };
  if (q.discount > 0) {
    line("Subtotal", brl(q.subtotal));
    line("Desconto", `- ${brl(q.discount)}`);
  }
  const ty = doc.y + 2;
  doc.roundedRect(L + W - 250, ty, 250, 30, 4).fill(BRAND.soft);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND.muted).text("VALOR TOTAL", L + W - 238, ty + 11, { characterSpacing: 0.8, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(BRAND.orange).text(brl(q.total), L + W - 150, ty + 8, { width: 142, align: "right", lineBreak: false });
  doc.fillColor(BRAND.ink);
  doc.x = L;
  doc.y = ty + 46;

  ensureSpace(doc, 60);
  brandSection(doc, "Condição de pagamento");
  const calcPayment = {
    ...q.payment,
    financed: Math.max(0, q.total - q.payment.downPayment),
    installmentValue: q.payment.installments > 0 ? Math.round(((q.total - q.payment.downPayment) / q.payment.installments) * 100) / 100 : 0,
  };
  doc.font("Helvetica").fontSize(10).text(q.paymentTerms?.trim() || paymentText(calcPayment, brl), L, doc.y, { width: W, lineGap: 2 });
  if (q.notes) {
    doc.moveDown(0.8);
    ensureSpace(doc, 50);
    brandSection(doc, "Observações");
    doc.font("Helvetica").fontSize(10).text(q.notes, L, doc.y, { width: W, lineGap: 2 });
  }
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.muted).text(`Valores válidos até ${brDate(q.validUntil)}. Após essa data o orçamento precisa ser revisto.`, L, doc.y, { width: W });
  doc.fillColor(BRAND.ink);

  // Assinatura do responsável pela venda
  ensureSpace(doc, 120);
  const sy = Math.max(doc.y + 24, doc.page.height - doc.page.margins.bottom - 100);
  const sx = L + W / 2 - 110;
  if (seller?.signatureImage?.startsWith("data:image/png;base64,")) {
    try {
      doc.image(Buffer.from(seller.signatureImage.split(",")[1], "base64"), sx + 30, sy, { fit: [160, 55] });
    } catch {
      /* imagem inválida: fica só a linha */
    }
  }
  const ly = sy + 60;
  doc.moveTo(sx, ly).lineTo(sx + 220, ly).strokeColor(BRAND.ink).lineWidth(0.7).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).text(seller?.name ?? q.seller.name, sx, ly + 5, { width: 220, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.muted).text(seller?.position || "Responsável pela venda", sx, doc.y, { width: 220, align: "center" });
  doc.end();
  return done;
}
