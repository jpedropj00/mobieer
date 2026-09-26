/**
 * Orçamento — preço com mark-up, comissão por dentro, financeira e pontuação.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PRICING, computeQuote, normalizePricing, paymentText, type PricingConfig, type QuoteInput } from "../src/modules/commercial/quote.rules";

const config: PricingConfig = {
  ...DEFAULT_PRICING,
  minScore: 1.5,
  financingPlans: [
    { id: "sant19", name: "Santander 19x sem entrada", method: "FINANCEIRA", installments: 19, feePercent: 10, requiresDownPayment: false },
    { id: "bv10e", name: "BV 10x com entrada", method: "FINANCEIRA", installments: 10, feePercent: 5, requiresDownPayment: true },
  ],
};
const brl = (n: number) => `R$ ${n.toFixed(2)}`;
const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  items: [{ room: "Cozinha", description: "Cozinha completa", unitCost: 600 }],
  markup: 1000 / 600,
  commissions: [],
  payment: { method: "AVISTA" },
  ...over,
});

test("custo R$ 600 com mark-up vira R$ 1.000, e a pontuação é o próprio mark-up", () => {
  const q = computeQuote(base(), config);
  assert.equal(q.costTotal, 600);
  assert.equal(q.total, 1000);
  assert.equal(q.result, 400);
  assert.equal(q.marginPercent, 40);
  assert.equal(q.score, 1.6667);
  assert.equal(q.needsApproval, false);
});

test("comissão entra por dentro: pagas as comissões, sobra custo × mark-up", () => {
  const q = computeQuote(
    base({ commissions: [{ name: "Ana", role: "VENDEDOR", percent: 3 }, { name: "Rui", role: "PROJETISTA", percent: 2 }] }),
    config
  );
  assert.equal(q.commissionPercent, 5);
  assert.equal(q.total, 1052.63); // 1000 / 0,95
  assert.equal(q.commissions[0].amount, 31.58);
  assert.equal(q.commissions[1].amount, 21.05);
  assert.equal(q.score, 1.6667);
  assert.equal(q.result, 400); // o que sobra depois de pagar os dois
});

test("desconto, frete e outros custos derrubam a pontuação e pedem liberação", () => {
  const q = computeQuote(base({ discount: 100, freight: 50, otherCosts: 30 }), config);
  assert.equal(q.total, 900);
  assert.equal(q.result, 220);
  assert.equal(q.score, 1.3667);
  assert.equal(q.needsApproval, true);
});

test("financeira: taxa sobre o financiado sai do resultado; parcela sem entrada", () => {
  const q = computeQuote(base({ payment: { method: "FINANCEIRA", planId: "sant19" } }), config);
  assert.equal(q.payment.installments, 19);
  assert.equal(q.payment.financed, 1000);
  assert.equal(q.payment.installmentValue, 52.63);
  assert.equal(q.payment.financingFee, 100);
  assert.equal(q.netRevenue, 900);
  assert.equal(q.result, 300);
  assert.equal(paymentText(q.payment, brl), "19x de R$ 52.63 (Santander 19x sem entrada) sem entrada");
});

test("plano que exige entrada recusa sem entrada; com entrada, só o restante paga taxa", () => {
  assert.throws(() => computeQuote(base({ payment: { method: "FINANCEIRA", planId: "bv10e" } }), config), /exige entrada/);
  const q = computeQuote(base({ payment: { method: "FINANCEIRA", planId: "bv10e", downPayment: 200 } }), config);
  assert.equal(q.payment.financed, 800);
  assert.equal(q.payment.financingFee, 40);
  assert.equal(q.payment.installmentValue, 80);
  assert.equal(paymentText(q.payment, brl), "Entrada de R$ 200.00 + 10x de R$ 80.00 (BV 10x com entrada)");
});

test("à vista não cobra taxa mesmo se vier percentual; plano inexistente é erro", () => {
  const q = computeQuote(base({ payment: { method: "PIX", feePercent: 3 } }), config);
  assert.equal(q.payment.financingFee, 0);
  assert.equal(q.payment.installments, 1);
  assert.throws(() => computeQuote(base({ payment: { method: "FINANCEIRA", planId: "nao-existe" } }), config), /não encontrado/);
});

test("vários ambientes e quantidade; desconto nunca passa do subtotal", () => {
  const q = computeQuote(
    base({ items: [{ room: "Cozinha", description: "Cozinha", unitCost: 600 }, { room: "Quarto", description: "Nicho", unitCost: 150, quantity: 2 }], discount: 99999 }),
    config
  );
  assert.equal(q.costTotal, 900);
  assert.equal(q.items[1].total, 500);
  assert.equal(q.items[1].unitPrice, 250);
  assert.equal(q.discount, q.subtotal);
  assert.equal(q.total, 0);
  assert.equal(q.marginPercent, null);
});

test("limites: mark-up zero e comissão acima de 50% são recusados; sem custo não há pontuação", () => {
  assert.throws(() => computeQuote(base({ markup: 0 }), config), /mark-up/);
  assert.throws(() => computeQuote(base({ commissions: [{ name: "X", role: "VENDEDOR", percent: 51 }] }), config), /50%/);
  const q = computeQuote(base({ items: [{ description: "Serviço", unitCost: 0 }] }), config);
  assert.equal(q.score, null);
  assert.equal(q.needsApproval, false);
});

test("configuração gravada incompleta é completada com o padrão", () => {
  const c = normalizePricing({ minScore: 1.8, defaultMarkup: -1 });
  assert.equal(c.minScore, 1.8);
  assert.equal(c.defaultMarkup, DEFAULT_PRICING.defaultMarkup);
  assert.deepEqual(c.financingPlans, []);
  assert.equal(normalizePricing(null).validityDays, 10);
});
