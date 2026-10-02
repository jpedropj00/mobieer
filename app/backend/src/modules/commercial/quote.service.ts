import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { brl } from "../templates/contract.service";
import { normalizePricing, paymentText, type PaymentMethod, type PricingConfig, type QuoteCalc } from "./quote.rules";
import { quoteModelPdf } from "./quote.pdf";
import { splitCityFromAddress } from "../aftersales/warranty-manual.rules";

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
  client: { select: { id: true, name: true, document: true, phone: true, email: true, address: true, street: true, addressNumber: true, complement: true, district: true, city: true, state: true, zipCode: true } },
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
      corpo: i.corpo,
      porta: i.porta,
      puxador: i.puxador,
      complemento: i.complemento,
      modelo: i.modelo,
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
        corpo: i.corpo,
        porta: i.porta,
        puxador: i.puxador,
        complemento: i.complemento,
        modelo: i.modelo,
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

/** PDF do orçamento para o cliente, no modelo da loja (quote.pdf.ts). */
export async function quotePdf(q: ReturnType<typeof serializeQuote>, organizationId: string): Promise<Buffer> {
  const [org, seller, pricing] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, include: { enterprise: true } }),
    prisma.user.findUnique({ where: { id: q.seller.id }, select: { name: true, signatureImage: true } }),
    loadPricing(),
  ]);
  const ent = org?.enterprise;
  const c = q.client;
  const street = [c.street, c.addressNumber, c.complement].filter(Boolean).join(", ");
  const legacy = splitCityFromAddress(c.address);
  const legacyCity = legacy.city ? { city: legacy.city.split(" / ")[0], uf: legacy.city.split(" / ")[1] } : null;
  const payment = {
    ...q.payment,
    financed: Math.max(0, q.total - q.payment.downPayment),
    installmentValue: q.payment.installments > 0 ? Math.round(((q.total - q.payment.downPayment) / q.payment.installments) * 100) / 100 : 0,
  };
  return quoteModelPdf({
    number: q.number,
    version: q.version,
    issuedAt: q.issuedAt,
    validUntil: q.validUntil,
    seller: { name: seller?.name ?? q.seller.name, signatureImage: seller?.signatureImage },
    store: ent?.tradeName ?? "MOBIEER",
    company: {
      name: "MOBIEER MÓVEIS SOB MEDIDA",
      city: [ent?.municipio ?? "Fortaleza", ent?.uf ?? "CE"].join("-"),
      site: "www.mobieer.com.br",
      email: ent?.email ?? "contato@mobieer.com.br",
    },
    client: {
      name: c.name,
      // sem endereço estruturado, cidade/UF saem do fim do endereço digitado ("… — Fortaleza/CE")
      address: street || legacy.street,
      district: c.district,
      city: c.city ?? legacyCity?.city ?? null,
      state: c.state ?? legacyCity?.uf ?? null,
      zipCode: c.zipCode,
      phone: c.phone,
      email: c.email,
    },
    items: q.items,
    subtotal: q.subtotal,
    discount: q.discount,
    total: q.total,
    payment: q.paymentTerms?.trim() || paymentText(payment, brl),
    notes: q.notes,
    config: pricing.document,
  });
}
