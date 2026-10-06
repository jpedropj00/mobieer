/**
 * Orçamento: desconto em %, valor final combinado e as formas "entrada no PIX + …".
 * Caso de referência (vídeo de 06/10): custo 4.500, mark-up 2, comissões 3% + 2%,
 * fechado em R$ 7.000.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { planFinance } from "../src/modules/commercial/quote.finance";
import { DEFAULT_PRICING, PAYMENT_LABEL, computeQuote, hasPixEntry, paymentText, settlementOf, type QuoteInput } from "../src/modules/commercial/quote.rules";

const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  items: [{ room: "Capeamento de mesas", description: "Tampos", unitCost: 4500 }],
  markup: 2,
  commissions: [
    { name: "Jéssica", role: "VENDEDOR", percent: 3 },
    { name: "Pessoa", role: "PROJETISTA", percent: 2 },
  ],
  payment: { method: "AVISTA" },
  ...over,
});

test("desconto em R$ continua igual: o caso do vídeo dá pontuação 1,48", () => {
  const c = computeQuote(base({ discount: 2473.68 }), DEFAULT_PRICING);
  assert.equal(c.subtotal, 9473.68);
  assert.equal(c.total, 7000);
  assert.equal(c.commissionTotal, 350);
  assert.equal(c.score, 1.4778);
  assert.equal(c.discountMode, "VALOR");
  assert.equal(c.needsApproval, true);
});

test("com desconto em R$, baixar a comissão só baixa o valor final (a queixa do vídeo)", () => {
  const c = computeQuote(base({ discount: 2473.68, commissions: [{ name: "Jéssica", role: "VENDEDOR", percent: 3 }] }), DEFAULT_PRICING);
  assert.ok(c.total < 7000); // o preço caiu junto com a comissão
  assert.ok(Math.abs(c.score! - 1.4778) < 0.03); // e a pontuação quase não mexe
});

test("fechando no valor final, baixar a comissão mantém os R$ 7.000 e melhora a pontuação", () => {
  const antes = computeQuote(base({ targetTotal: 7000 }), DEFAULT_PRICING);
  assert.equal(antes.total, 7000);
  assert.equal(antes.discount, 2473.68);
  assert.equal(antes.score, 1.4778);
  assert.equal(antes.discountMode, "TOTAL");

  const depois = computeQuote(base({ targetTotal: 7000, commissions: [{ name: "Jéssica", role: "VENDEDOR", percent: 3 }] }), DEFAULT_PRICING);
  assert.equal(depois.total, 7000); // o cliente paga o mesmo
  assert.equal(depois.commissionTotal, 210);
  assert.equal(depois.score, 1.5089); // (7000 − 210) / 4500
  assert.ok(depois.score! > antes.score!);
});

test("valor final acima do preço de venda não vira acréscimo: o desconto fica zero", () => {
  const c = computeQuote(base({ targetTotal: 20000 }), DEFAULT_PRICING);
  assert.equal(c.discount, 0);
  assert.equal(c.total, c.subtotal);
});

test("desconto em % acompanha o preço: mudando o mark-up, o percentual é o mesmo", () => {
  const a = computeQuote(base({ discountPercent: 10 }), DEFAULT_PRICING);
  assert.equal(a.discount, 947.37);
  assert.equal(a.total, 8526.31);
  assert.equal(a.discountMode, "PERCENTUAL");
  assert.equal(a.discountRate, 10);
  const b = computeQuote(base({ discountPercent: 10, markup: 2.5 }), DEFAULT_PRICING);
  assert.equal(b.discountRate, 10);
  assert.ok(b.total > a.total && b.score! > a.score!);
  // o percentual vale no lugar do desconto em R$ informado junto
  assert.equal(computeQuote(base({ discountPercent: 10, discount: 5000 }), DEFAULT_PRICING).discount, 947.37);
  assert.equal(computeQuote(base({ discountPercent: 150 }), DEFAULT_PRICING).total, 0); // nunca passa de 100%
});

test("entrada no PIX + boleto / cartão / financeira: o saldo segue a segunda forma", () => {
  assert.equal(settlementOf("PIX_BOLETO"), "BOLETO");
  assert.equal(settlementOf("PIX_CARTAO"), "CARTAO");
  assert.equal(settlementOf("PIX_FINANCEIRA"), "FINANCEIRA");
  assert.equal(settlementOf("PIX"), "PIX");
  assert.equal(hasPixEntry("PIX_BOLETO"), true);
  assert.equal(hasPixEntry("PIX"), false);
  assert.equal(PAYMENT_LABEL.PIX_CARTAO, "Entrada no PIX + cartão");

  const boleto = computeQuote(base({ targetTotal: 7000, payment: { method: "PIX_BOLETO", downPayment: 2000, installments: 10 } }), DEFAULT_PRICING);
  assert.equal(boleto.payment.method, "PIX_BOLETO");
  assert.equal(boleto.payment.financed, 5000);
  assert.equal(boleto.payment.installments, 10);
  assert.equal(boleto.payment.installmentValue, 500);
  assert.equal(boleto.payment.financingFee, 0); // boleto não tem taxa retida
  assert.equal(paymentText(boleto.payment, brl), "Entrada de R$ 2000,00 no PIX + 10x de R$ 500,00 (Boleto parcelado)");

  const cartao = computeQuote(base({ targetTotal: 7000, payment: { method: "PIX_CARTAO", downPayment: 2000, installments: 5, feePercent: 4 } }), DEFAULT_PRICING);
  assert.equal(cartao.payment.financingFee, 200); // 4% sobre os 5.000 do cartão, não sobre a entrada
  assert.match(paymentText(cartao.payment, brl), /^Entrada de R\$ 2000,00 no PIX \+ 5x de R\$ 1000,00 \(Cartão de crédito\)$/);

  // PIX puro continua uma parcela só
  assert.equal(computeQuote(base({ payment: { method: "PIX", installments: 6 } }), DEFAULT_PRICING).payment.installments, 1);
});

test("financeiro do contrato: entrada no PIX e o saldo nas parcelas da segunda forma", () => {
  const q = { number: "ORC-00009", version: 1, total: 7000, commissions: [], payment: { method: "PIX_BOLETO", planName: null, installments: 4, downPayment: 2000, feePercent: 0 } };
  const out = planFinance(q as never, "2026-10-06").filter((e) => e.type === "RECEITA");
  assert.equal(out.length, 5);
  assert.deepEqual([out[0].amount, out[0].method, out[0].dueDay], [2000, "PIX", "2026-10-06"]);
  assert.match(out[0].description, /entrada \(PIX\)/);
  assert.deepEqual(out.slice(1).map((e) => [e.amount, e.method]), [[1250, "Boleto"], [1250, "Boleto"], [1250, "Boleto"], [1250, "Boleto"]]);
  assert.equal(out[1].dueDay, "2026-11-06");

  const cartao = planFinance({ ...q, payment: { ...q.payment, method: "PIX_CARTAO", feePercent: 4 } } as never, "2026-10-06");
  assert.equal(cartao.filter((e) => e.type === "RECEITA" && e.method === "Cartão").length, 4);
  assert.equal(cartao.filter((e) => e.type === "DESPESA").reduce((s, e) => s + e.amount, 0), 200);
});
