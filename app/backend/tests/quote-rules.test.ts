/**
 * Orçamento — preço com mark-up, comissão por dentro, financeira e pontuação.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { quoteModelPdf } from "../src/modules/commercial/quote.pdf";
import { DEFAULT_PRICING, ambCode, computeQuote, normalizePricing, obsLabel, paymentText, quoteObservations, quoteRooms, type PricingConfig, type QuoteInput } from "../src/modules/commercial/quote.rules";

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

test("Promob → orçamento: ambientes com o subtotal do arquivo e a contagem de itens sem preço", async () => {
  const { hasBudgetValues, roomsFromParsed } = await import("../src/modules/commercial/quote.promob");
  const rooms = roomsFromParsed({
    itens: [
      { ambiente: "Cozinhas", valorTotal: 48.52 },
      { ambiente: "Cozinhas", valorTotal: 0 },
      { ambiente: "Ferragens", valorTotal: 0 },
      { ambiente: null, valorTotal: 10 },
    ],
    valoresPorAmbiente: [{ ambiente: "Cozinhas", valor: 1010.3 }],
  });
  assert.deepEqual(rooms, [
    { room: "Cozinhas", cost: 1010.3, items: 2, unpriced: 1 }, // o subtotal do arquivo manda sobre a soma
    { room: "Ferragens", cost: 0, items: 1, unpriced: 1 },
    { room: "Sem ambiente", cost: 10, items: 1, unpriced: 0 },
  ]);
  assert.equal(hasBudgetValues(rooms), true);
  assert.equal(hasBudgetValues(roomsFromParsed({ itens: [{ ambiente: "Cozinha", valorTotal: null }] })), false);
  assert.deepEqual(roomsFromParsed(null), []);
});

test("regra da loja: mark-up de 2 para cima fecha direto; abaixo pede liberação", () => {
  assert.equal(DEFAULT_PRICING.minScore, 2);
  const at = (markup: number, over: Partial<QuoteInput> = {}) => computeQuote(base({ markup, ...over }), DEFAULT_PRICING).needsApproval;
  assert.equal(at(2), false);
  assert.equal(at(2.4), false);
  assert.equal(at(1.99), true);
  assert.equal(at(1.67), true);
  // centavos arredondados não derrubam um mark-up de 2 cravado
  assert.equal(computeQuote(base({ markup: 2, items: [{ room: "Sala", description: "Painel", unitCost: 333.33 }], commissions: [{ name: "Ana", role: "VENDEDOR", percent: 3 }] }), DEFAULT_PRICING).needsApproval, false);
  // desconto que derruba o mark-up efetivo para menos de 2 volta a pedir liberação
  assert.equal(at(2, { discount: 100 }), true);
});

test("cômodos do orçamento: sem repetir, na ordem, e item sem cômodo entra pela descrição", () => {
  assert.deepEqual(
    quoteRooms([
      { room: "Cozinha", description: "Armários" },
      { room: " cozinha ", description: "Ilha" },
      { room: "Dormitório casal", description: "Guarda-roupa" },
      { room: null, description: "Painel de TV" },
    ]),
    ["Cozinha", "Dormitório casal", "Painel de TV"]
  );
  assert.deepEqual(quoteRooms([]), []);
});

test("modelo da loja: códigos de ambiente, rótulos das OBS e acabamentos no cálculo", () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(ambCode), ["AA", "AB", "AZ", "BA", "BB"]);
  assert.deepEqual([0, 1, 2, 3, 6].map(obsLabel), ["OBS:", "OBS²:", "OBS³:", "OBS4:", "OBS7:"]);
  const q = computeQuote(base({ items: [{ room: "Cozinha", description: "Armário alto", unitCost: 600, corpo: " MDF 15mm Branco TX ", porta: "", puxador: "Cava usinado" }] }), config);
  assert.deepEqual([q.items[0].corpo, q.items[0].porta, q.items[0].puxador, q.items[0].modelo], ["MDF 15mm Branco TX", null, "Cava usinado", null]);
});

test("configuração do PDF: completa com o padrão da loja e aceita lista de observações vazia", () => {
  const padrao = normalizePricing({}).document;
  assert.equal(padrao.supplier, "MOBIEER MÓVEIS PLANEJADOS");
  assert.equal(padrao.deliveryDays, 45);
  // a garantia saiu da lista: é a observação obrigatória; as outras 6 viraram atalhos
  assert.equal(padrao.notes.length, 6);
  const custom = normalizePricing({ document: { line: "CORPORATIVO", deliveryDays: 60, notes: [" Garantia de 5 anos ", ""] } }).document;
  assert.deepEqual([custom.line, custom.deliveryDays, custom.notes, custom.supplier], ["CORPORATIVO", 60, ["Garantia de 5 anos"], "MOBIEER MÓVEIS PLANEJADOS"]);
  assert.deepEqual(normalizePricing({ document: { notes: [] } }).document.notes, []);
});

test("PDF no modelo da loja: gera com muitos ambientes e observação longa sem quebrar", async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ room: `Ambiente ${i + 1}`, description: "Armário com portas de giro em MDF 15mm. ".repeat(12), quantity: 1, total: 1000 + i, corpo: "MDF 15mm", porta: null, puxador: null, complemento: null, modelo: null }));
  const pdf = await quoteModelPdf({
    number: "ORC-00009", version: 2, issuedAt: new Date("2026-08-22T15:00:00Z"), validUntil: new Date("2026-09-01T15:00:00Z"),
    seller: { name: "Vendedora" }, store: "Mobieer", company: { name: "MOBIEER MÓVEIS SOB MEDIDA", city: "Fortaleza-CE", site: "www.mobieer.com.br", email: null },
    client: { name: "Cliente", address: null, district: null, city: null, state: null, zipCode: null, phone: null, email: null },
    items, subtotal: 31000, discount: 500, total: 30500, payment: "À vista", notes: "Entrega sujeita à liberação da obra.", config: DEFAULT_PRICING.document,
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5000);
});

test("observações do PDF: só a garantia é fixa; o resto é o que foi escrito no orçamento", () => {
  const garantia = DEFAULT_PRICING.document.mandatoryNote;
  assert.match(garantia, /GARANTIA/);
  assert.deepEqual(quoteObservations(garantia, null), [garantia]);
  assert.deepEqual(quoteObservations(garantia, "Entrega no 3º andar\n\n  Montagem em 2 dias \n" + garantia.toLowerCase()), [garantia, "Entrega no 3º andar", "Montagem em 2 dias"]);
  // os atalhos não incluem a garantia, e config antiga (sem o campo) ganha a garantia
  assert.ok(!DEFAULT_PRICING.document.notes.includes(garantia));
  const antiga = normalizePricing({ document: { notes: [garantia, "ASSISTÊNCIA VITALÍCIA."] } }).document;
  assert.equal(antiga.mandatoryNote, garantia);
  assert.deepEqual(antiga.notes, ["ASSISTÊNCIA VITALÍCIA."]);
});
