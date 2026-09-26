/**
 * Orçamento aceito → contas a receber e a pagar no financeiro.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { addDaysDay, addMonthsDay, planFinance, splitAmount, type QuoteForFinance } from "../src/modules/commercial/quote.finance";

const q = (payment: Partial<QuoteForFinance["payment"]>, over: Partial<QuoteForFinance> = {}): QuoteForFinance => ({
  number: "ORC-00007",
  version: 1,
  total: 1000,
  payment: { method: "AVISTA", planName: null, installments: 1, downPayment: 0, feePercent: 0, ...payment },
  commissions: [],
  ...over,
});
const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

test("datas de calendário: fim de mês e virada de ano", () => {
  assert.equal(addMonthsDay("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsDay("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsDay("2026-11-15", 2), "2027-01-15");
  assert.equal(addDaysDay("2026-12-15", 30), "2027-01-14");
});

test("parcelas em centavos inteiros; o arredondamento cai na última", () => {
  assert.deepEqual(splitAmount(100, 3), [33.33, 33.33, 33.34]);
  assert.equal(sum(splitAmount(1052.63, 19).map((amount) => ({ amount }))), 1052.63);
});

test("PIX: um recebível no dia do aceite", () => {
  const p = planFinance(q({ method: "PIX" }), "2026-09-26");
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].type, p[0].amount, p[0].dueDay, p[0].method], ["RECEITA", 1000, "2026-09-26", "PIX"]);
});

test("boleto: entrada hoje e 10 parcelas mensais a partir do mês seguinte", () => {
  const p = planFinance(q({ method: "BOLETO", installments: 10, downPayment: 200 }), "2026-09-26");
  assert.equal(p.length, 11);
  assert.equal(p[0].description, "Orçamento ORC-00007 — entrada");
  assert.equal(p[0].dueDay, "2026-09-26");
  assert.equal(p[1].dueDay, "2026-10-26");
  assert.equal(p[10].dueDay, "2027-07-26");
  assert.equal(p[10].installmentNumber, 10);
  assert.equal(p[10].installmentTotal, 10);
  assert.equal(sum(p), 1000);
});

test("financeira: repasse único em 30 dias e a taxa como despesa no mesmo dia", () => {
  const p = planFinance(q({ method: "FINANCEIRA", planName: "Santander 19x sem entrada", installments: 19, feePercent: 10 }), "2026-09-26");
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].type, p[0].amount, p[0].dueDay], ["RECEITA", 1000, "2026-10-26"]);
  assert.match(p[0].description, /repasse Santander 19x/);
  assert.deepEqual([p[1].type, p[1].category, p[1].amount, p[1].dueDay], ["DESPESA", "Taxa de financiamento", 100, "2026-10-26"]);
});

test("cartão: um repasse e uma taxa por parcela, somando o total", () => {
  const p = planFinance(q({ method: "CARTAO", installments: 3, feePercent: 4 }), "2026-09-26");
  const rec = p.filter((x) => x.type === "RECEITA");
  const fee = p.filter((x) => x.type === "DESPESA");
  assert.equal(rec.length, 3);
  assert.equal(fee.length, 3);
  assert.equal(sum(rec), 1000);
  assert.equal(sum(fee), 40);
  assert.equal(fee[0].category, "Taxa de cartão");
});

test("comissões viram contas a pagar no vencimento da primeira parcela; sem taxa não há despesa de taxa", () => {
  const p = planFinance(
    q({ method: "BOLETO", installments: 2 }, { commissions: [{ name: "Ana", percent: 3, amount: 31.58 }, { name: "Rui", percent: 0, amount: 0 }] }),
    "2026-09-26"
  );
  const com = p.filter((x) => x.category === "Comissão de venda");
  assert.equal(com.length, 1);
  assert.equal(com[0].amount, 31.58);
  assert.equal(com[0].dueDay, "2026-10-26");
  assert.equal(com[0].description, "Orçamento ORC-00007 — comissão Ana (3%)");
  assert.equal(p.filter((x) => x.category.startsWith("Taxa")).length, 0);
});

test("entrada cobrindo o total: só a entrada; versão aparece na descrição", () => {
  const p = planFinance(q({ method: "BOLETO", installments: 5, downPayment: 5000 }, { version: 2 }), "2026-09-26");
  assert.equal(p.length, 1);
  assert.equal(p[0].amount, 1000);
  assert.equal(p[0].description, "Orçamento ORC-00007 v2 — entrada");
});
