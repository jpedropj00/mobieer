import { BRAND, PAGE, brandDocument, brandSection, brandTitle, ensureSpace } from "../../lib/brand-pdf";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { brl } from "../templates/contract.service";
import { normalizePricing, quoteRooms, type PaymentMethod, type PricingConfig, type QuoteCalc } from "./quote.rules";

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
 * PDF do orçamento para o cliente, enxuto: o nome do cliente, os cômodos e o
 * valor final. Itens, valores por cômodo, condição de pagamento, custo,
 * mark-up e comissões ficam só na tela do orçamento.
 */
export async function quotePdf(q: ReturnType<typeof serializeQuote>, organizationId: string): Promise<Buffer> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, include: { enterprise: true } });
  const ent = org?.enterprise;
  const contacts = [ent?.phone, ent?.email].filter((x): x is string => Boolean(x));
  const { doc, done, width: W } = brandDocument({ contacts: contacts.length ? [...contacts, "www.mobieer.com.br"] : undefined });
  const L = PAGE.left;

  brandTitle(doc, `Orçamento ${q.number}${q.version > 1 ? ` · versão ${q.version}` : ""}`, `Emitido em ${brDate(q.issuedAt)}   ·   Válido até ${brDate(q.validUntil)}`);

  brandSection(doc, "Cliente");
  doc.font("Helvetica-Bold").fontSize(15).fillColor(BRAND.ink).text(q.client.name, L, doc.y, { width: W });
  doc.moveDown(1.2);

  const rooms = quoteRooms(q.items);
  brandSection(doc, rooms.length === 1 ? "Cômodo" : "Cômodos");
  for (const room of rooms) {
    ensureSpace(doc, 24);
    const y = doc.y;
    doc.font("Helvetica").fontSize(11).fillColor(BRAND.orange).text("•", L + 2, y, { lineBreak: false });
    doc.fillColor(BRAND.ink).text(room, L + 16, y, { width: W - 16, lineGap: 3 });
    doc.moveDown(0.25);
  }
  doc.x = L;
  doc.moveDown(1.2);

  ensureSpace(doc, 70);
  const ty = doc.y;
  doc.roundedRect(L, ty, W, 46, 5).fill(BRAND.soft);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND.muted).text("VALOR TOTAL", L + 18, ty + 18, { characterSpacing: 0.8, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(BRAND.orange).text(brl(q.total), L + W / 2, ty + 13, { width: W / 2 - 18, align: "right", lineBreak: false });
  doc.fillColor(BRAND.ink);
  doc.end();
  return done;
}
