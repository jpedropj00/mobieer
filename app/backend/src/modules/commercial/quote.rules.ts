/**
 * Orçamento — formação do preço, comissões, financeira e pontuação.
 *
 * O custo de cada ambiente já inclui tudo (peças e mão de obra/montagem). Sobre
 * ele entra o mark-up; a comissão é acrescentada à parte, "por dentro": o preço
 * é inflado para que, pagas as comissões, sobre exatamente custo × mark-up.
 *
 * A pontuação é o mark-up que a venda realmente entrega depois de desconto,
 * taxa da financeira, comissões, frete e demais custos — na mesma escala do
 * mark-up (sem nenhum abatimento, pontuação = mark-up). Abaixo do mínimo
 * configurado, o orçamento só segue com liberação.
 */

export const PAYMENT_METHODS = ["AVISTA", "PIX", "BOLETO", "CARTAO", "FINANCEIRA"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  AVISTA: "À vista",
  PIX: "PIX",
  BOLETO: "Boleto parcelado",
  CARTAO: "Cartão de crédito",
  FINANCEIRA: "Financeira",
};

export type FinancingPlan = {
  id: string;
  /** Ex.: "Santander 19x sem entrada". */
  name: string;
  method: "CARTAO" | "FINANCEIRA";
  installments: number;
  /** % que a financeira/maquininha retém sobre o valor financiado. */
  feePercent: number;
  requiresDownPayment: boolean;
};

export type CommissionRole = { role: string; label: string; defaultPercent: number };

/** O que sai fixo no PDF do orçamento (modelo da loja). */
export type QuoteDocumentConfig = {
  supplier: string;
  line: string;
  /** prazo em dias de cada ambiente */
  deliveryDays: number;
  deliveryText: string;
  /** observações do rodapé: OBS, OBS², OBS³… */
  notes: string[];
};

export type PricingConfig = {
  defaultMarkup: number;
  minScore: number;
  validityDays: number;
  commissionRoles: CommissionRole[];
  financingPlans: FinancingPlan[];
  document: QuoteDocumentConfig;
};

export const DEFAULT_QUOTE_DOCUMENT: QuoteDocumentConfig = {
  supplier: "MOBIEER MÓVEIS PLANEJADOS",
  line: "RESIDENCIAL",
  deliveryDays: 45,
  deliveryText: "Em dias úteis conforme ambientes",
  notes: [
    "5 ANOS DE GARANTIA PARA MÓVEIS E FERRAGENS (COM EXCEÇÃO DE SITUAÇÕES CONFIGURADAS MAU USO).",
    "PRODUÇÃO 100% INDUSTRIAL E FABRICAÇÃO PRÓPRIA.",
    "ASSISTÊNCIA VITALÍCIA.",
    "TODAS AS PORTAS DE GIRO COM AMORTECEDOR.",
    "TODAS AS PEÇAS, PORTAS, MÓDULOS, TAMPONAMENTOS E CAIXARIAS EM MDF NAVAL.",
    "FERRAGENS INOX, VISANDO MAIOR DURABILIDADE.",
    "CORREDIÇAS INVISÍVEIS NA COZINHA, PORTAS DESLIZANTES COM AMORTECEDOR, DOBRADIÇAS COM ARTICULADORES E AMORTECEDOR.",
  ],
};

/** Código do ambiente no orçamento: AA, AB, AC… */
export function ambCode(index: number): string {
  const A = 65;
  return String.fromCharCode(A + (Math.floor(index / 26) % 26)) + String.fromCharCode(A + (index % 26));
}

/** Rótulo da observação fixa: OBS:, OBS²:, OBS³:, OBS4:… */
export function obsLabel(index: number): string {
  return index === 0 ? "OBS:" : index === 1 ? "OBS²:" : index === 2 ? "OBS³:" : `OBS${index + 1}:`;
}

export const DEFAULT_PRICING: PricingConfig = {
  defaultMarkup: 1.67, // custo R$ 600 → venda R$ 1.000
  // mark-up efetivo (o que sobra sobre o custo): de 2 para cima fecha direto, abaixo precisa de liberação
  minScore: 2,
  validityDays: 10,
  commissionRoles: [
    { role: "VENDEDOR", label: "Vendedor", defaultPercent: 3 },
    { role: "PROJETISTA", label: "Projetista", defaultPercent: 2 },
  ],
  financingPlans: [],
  document: DEFAULT_QUOTE_DOCUMENT,
};

/** Comissão somada acima disto torna o preço absurdo (divide por quase zero). */
export const MAX_COMMISSION_PERCENT = 50;

export const FINISH_FIELDS = ["corpo", "porta", "puxador", "complemento", "modelo"] as const;
export type Finishes = Partial<Record<(typeof FINISH_FIELDS)[number], string | null>>;
export type QuoteItemInput = { room?: string | null; description: string; quantity?: number; unitCost: number } & Finishes;
/** Papel da linha de comissão que é a reserva técnica do indicador (arquiteto/parceiro). */
export const REFERRER_ROLE = "INDICADOR";

export type CommissionInput = { userId?: string | null; referrerId?: string | null; name: string; role: string; percent: number };
export type PaymentInput = {
  method: PaymentMethod;
  planId?: string | null;
  installments?: number | null;
  downPayment?: number | null;
  /** % retido; vem do plano, mas pode ser informado quando não há plano. */
  feePercent?: number | null;
};
export type QuoteInput = {
  items: QuoteItemInput[];
  markup: number;
  commissions: CommissionInput[];
  discount?: number;
  freight?: number;
  otherCosts?: number;
  payment: PaymentInput;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const pos = (n: number | null | undefined) => (n && n > 0 ? n : 0);

export class QuoteRuleError extends Error {}

export function computeQuote(input: QuoteInput, config: PricingConfig) {
  if (!(input.markup > 0)) throw new QuoteRuleError("O mark-up precisa ser maior que zero");
  const commissionPercent = r2(input.commissions.reduce((s, c) => s + pos(c.percent), 0));
  if (commissionPercent > MAX_COMMISSION_PERCENT) throw new QuoteRuleError(`A soma das comissões passa de ${MAX_COMMISSION_PERCENT}%`);
  const gross = input.markup / (1 - commissionPercent / 100);

  const items = input.items.map((it) => {
    const quantity = it.quantity && it.quantity > 0 ? it.quantity : 1;
    const cost = r2(pos(it.unitCost) * quantity);
    const total = r2(cost * gross);
    const finish = (k: (typeof FINISH_FIELDS)[number]) => it[k]?.trim() || null;
    return {
      room: it.room?.trim() || null,
      description: it.description.trim(),
      corpo: finish("corpo"),
      porta: finish("porta"),
      puxador: finish("puxador"),
      complemento: finish("complemento"),
      modelo: finish("modelo"),
      quantity,
      unitCost: pos(it.unitCost),
      cost,
      unitPrice: r2(total / quantity),
      total,
    };
  });
  const costTotal = r2(items.reduce((s, i) => s + i.cost, 0));
  const subtotal = r2(items.reduce((s, i) => s + i.total, 0));
  const discount = Math.min(r2(pos(input.discount)), subtotal);
  const total = r2(subtotal - discount);
  const freight = r2(pos(input.freight));
  const otherCosts = r2(pos(input.otherCosts));

  const commissions = input.commissions
    .filter((c) => pos(c.percent) > 0)
    .map((c) => ({ userId: c.userId ?? null, referrerId: c.referrerId ?? null, name: c.name.trim(), role: c.role, percent: r2(c.percent), amount: r2((total * c.percent) / 100) }));
  const commissionTotal = r2(commissions.reduce((s, c) => s + c.amount, 0));

  // Pagamento: entrada + o restante no plano escolhido.
  const plan = input.payment.planId ? config.financingPlans.find((p) => p.id === input.payment.planId) ?? null : null;
  if (input.payment.planId && !plan) throw new QuoteRuleError("Plano de pagamento não encontrado nas configurações");
  const method = plan?.method ?? input.payment.method;
  const downPayment = Math.min(r2(pos(input.payment.downPayment)), total);
  if (plan?.requiresDownPayment && downPayment <= 0) throw new QuoteRuleError(`${plan.name} exige entrada`);
  const financed = r2(total - downPayment);
  const installments = plan?.installments ?? (method === "AVISTA" || method === "PIX" ? 1 : Math.max(1, Math.floor(input.payment.installments ?? 1)));
  const feePercent = method === "CARTAO" || method === "FINANCEIRA" ? r2(plan?.feePercent ?? pos(input.payment.feePercent)) : 0;
  const financingFee = r2((financed * feePercent) / 100);
  const installmentValue = financed > 0 ? r2(financed / installments) : 0;

  // O que fica para a loja e o que sobra depois de tudo.
  const netRevenue = r2(total - financingFee);
  const result = r2(netRevenue - costTotal - commissionTotal - freight - otherCosts);
  const marginPercent = total > 0 ? r2((result / total) * 100) : null;
  const score = costTotal > 0 ? r4((netRevenue - commissionTotal - freight - otherCosts) / costTotal) : null;
  // folga de meio centésimo: o preço é arredondado em centavos e um mark-up de 2,00 pode dar 1,9999
  const needsApproval = score != null && score < config.minScore - 0.005;

  return {
    items,
    costTotal,
    markup: r4(input.markup),
    commissionPercent,
    subtotal,
    discount,
    total,
    freight,
    otherCosts,
    commissions,
    commissionTotal,
    payment: {
      method,
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      downPayment,
      financed,
      installments,
      installmentValue,
      feePercent,
      financingFee,
    },
    netRevenue,
    result,
    marginPercent,
    score,
    minScore: config.minScore,
    needsApproval,
  };
}

export type QuoteCalc = ReturnType<typeof computeQuote>;

/** Cômodos do orçamento, sem repetir e na ordem em que aparecem (item sem cômodo entra pela descrição). */
export function quoteRooms(items: { room?: string | null; description: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const name = (it.room?.trim() || it.description.trim()).replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Texto da condição de pagamento para o PDF e o contrato. */
export function paymentText(p: QuoteCalc["payment"], brl: (n: number) => string): string {
  const entrada = p.downPayment > 0 ? `Entrada de ${brl(p.downPayment)} + ` : "";
  if (p.financed <= 0) return `À vista: ${brl(p.downPayment)}`;
  if (p.method === "AVISTA" || p.method === "PIX") return `${PAYMENT_LABEL[p.method]}: ${brl(p.financed)}`;
  const onde = p.planName ?? PAYMENT_LABEL[p.method];
  return `${entrada}${p.installments}x de ${brl(p.installmentValue)} (${onde})${p.downPayment > 0 ? "" : " sem entrada"}`;
}

function normalizeDocument(raw: unknown): QuoteDocumentConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<QuoteDocumentConfig>;
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const D = DEFAULT_QUOTE_DOCUMENT;
  return {
    supplier: str(o.supplier, D.supplier),
    line: str(o.line, D.line),
    deliveryDays: typeof o.deliveryDays === "number" && o.deliveryDays > 0 ? Math.round(o.deliveryDays) : D.deliveryDays,
    deliveryText: str(o.deliveryText, D.deliveryText),
    // lista vazia é uma escolha válida (orçamento sem observações fixas)
    notes: Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === "string" && Boolean(n.trim())).map((n) => n.trim()) : D.notes,
  };
}

/** Aceita o que vier gravado e completa com o padrão — config velha não quebra a tela. */
export function normalizePricing(raw: unknown): PricingConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<PricingConfig>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  return {
    defaultMarkup: num(o.defaultMarkup, DEFAULT_PRICING.defaultMarkup),
    minScore: num(o.minScore, DEFAULT_PRICING.minScore),
    validityDays: Math.round(num(o.validityDays, DEFAULT_PRICING.validityDays)),
    commissionRoles: Array.isArray(o.commissionRoles) && o.commissionRoles.length ? o.commissionRoles : DEFAULT_PRICING.commissionRoles,
    financingPlans: Array.isArray(o.financingPlans) ? o.financingPlans : [],
    document: normalizeDocument(o.document),
  };
}
