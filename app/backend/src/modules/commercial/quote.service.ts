import PDFDocument from "pdfkit";
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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 48, right: 48 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const W = doc.page.width - 96;
    const L = 48;

    doc.font("Helvetica-Bold").fontSize(13).text(ent?.tradeName ?? ent?.legalName ?? "Orçamento", L, 48);
    doc.font("Helvetica").fontSize(8.5).fillColor("#555");
    const contato = [ent?.document ? `CNPJ ${ent.document}` : null, ent?.phone, ent?.email].filter(Boolean).join("  ·  ");
    if (contato) doc.text(contato);
    doc.fillColor("#000").moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(15).text(`ORÇAMENTO ${q.number}${q.version > 1 ? ` — versão ${q.version}` : ""}`);
    doc.font("Helvetica").fontSize(9.5).text(`Emitido em ${brDate(q.issuedAt)}   ·   Válido até ${brDate(q.validUntil)}`);
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(10).text("Cliente");
    doc.font("Helvetica").fontSize(9.5).text(q.client.name);
    const cli = [q.client.document, q.client.phone, q.client.email].filter(Boolean).join("  ·  ");
    if (cli) doc.text(cli);
    if (q.client.address) doc.text(q.client.address);
    if (q.project) doc.text(`Projeto ${q.project.code} — ${q.project.name}`);
    doc.moveDown(0.8);

    // Tabela: ambiente/descrição | qtd | valor
    const colQ = L + W - 150;
    const colV = L + W - 90;
    const header = () => {
      const y = doc.y;
      doc.rect(L, y, W, 18).fill("#f1f1f1").fillColor("#000");
      doc.font("Helvetica-Bold").fontSize(9).text("Ambiente / item", L + 6, y + 5, { width: colQ - L - 12 });
      doc.text("Qtd", colQ, y + 5, { width: 50, align: "right" });
      doc.text("Valor", colV, y + 5, { width: 84, align: "right" });
      doc.y = y + 22;
    };
    header();
    doc.font("Helvetica").fontSize(9.5);
    for (const it of q.items) {
      const label = it.room ? `${it.room} — ${it.description}` : it.description;
      const h = Math.max(doc.heightOfString(label, { width: colQ - L - 12 }), 11) + 6;
      if (doc.y + h > doc.page.height - 160) {
        doc.addPage();
        header();
        doc.font("Helvetica").fontSize(9.5);
      }
      const y = doc.y;
      doc.text(label, L + 6, y, { width: colQ - L - 12 });
      doc.text(String(it.quantity).replace(".", ","), colQ, y, { width: 50, align: "right" });
      doc.text(brl(it.total), colV, y, { width: 84, align: "right" });
      doc.y = y + h;
      doc.moveTo(L, doc.y - 3).lineTo(L + W, doc.y - 3).strokeColor("#e5e5e5").lineWidth(0.5).stroke();
    }

    doc.moveDown(0.5);
    const line = (k: string, v: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5);
      doc.text(k, colQ - 120, y, { width: 170, align: "right" });
      doc.text(v, colV, y, { width: 84, align: "right" });
      doc.moveDown(0.3);
    };
    if (q.discount > 0) {
      line("Subtotal", brl(q.subtotal));
      line("Desconto", `- ${brl(q.discount)}`);
    }
    line("Total", brl(q.total), true);
    doc.x = L;
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(10).text("Condição de pagamento", L);
    const calcPayment = {
      ...q.payment,
      financed: Math.max(0, q.total - q.payment.downPayment),
      installmentValue: q.payment.installments > 0 ? Math.round(((q.total - q.payment.downPayment) / q.payment.installments) * 100) / 100 : 0,
    };
    doc.font("Helvetica").fontSize(9.5).text(q.paymentTerms?.trim() || paymentText(calcPayment, brl));
    if (q.notes) {
      doc.moveDown(0.6);
      doc.font("Helvetica-Bold").fontSize(10).text("Observações");
      doc.font("Helvetica").fontSize(9.5).text(q.notes);
    }

    // Assinatura do responsável pela venda
    if (doc.y > doc.page.height - 170) doc.addPage();
    doc.y = Math.max(doc.y + 30, doc.page.height - 170);
    const sx = L + W / 2 - 110;
    if (seller?.signatureImage?.startsWith("data:image/png;base64,")) {
      try {
        doc.image(Buffer.from(seller.signatureImage.split(",")[1], "base64"), sx + 30, doc.y, { fit: [160, 55] });
      } catch {
        /* imagem inválida: fica só a linha */
      }
    }
    const ly = doc.y + 60;
    doc.moveTo(sx, ly).lineTo(sx + 220, ly).strokeColor("#000").lineWidth(0.7).stroke();
    doc.font("Helvetica-Bold").fontSize(9.5).text(seller?.name ?? q.seller.name, sx, ly + 4, { width: 220, align: "center" });
    doc.font("Helvetica").fontSize(8.5).text(seller?.position || "Responsável pela venda", sx, doc.y, { width: 220, align: "center" });
    doc.end();
  });
}
