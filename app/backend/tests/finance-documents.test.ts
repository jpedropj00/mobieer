/**
 * Regras dos documentos financeiros: saldo, pagamento parcial, situação
 * derivada do vencimento e agrupamento por dia/semana/mês.
 *
 * Tudo aqui é função pura — o dinheiro é a parte do sistema que menos pode
 * depender de teste manual.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FinanceStatus } from "@prisma/client";
import {
  ALERT_DAY_OPTIONS,
  DEFAULT_ALERT_DAYS,
  FINANCE_SITUATIONS,
  SITUATION_LABEL,
  assertPayable,
  assertPaymentAmount,
  daysUntilDue,
  dueBucket,
  financeSituation,
  groupByDue,
  isOpen,
  localDay,
  normalizeAlertDays,
  remainingBalance,
  statusAfterPayments,
  weekStart,
} from "../src/modules/finance/documents.service";

// 18/09/2026 12:00 UTC = 09:00 em Fortaleza
const HOJE = new Date("2026-09-18T12:00:00Z");
const dia = (d: string) => new Date(`${d}T12:00:00Z`);

// ---------------------------------------------------------------------------
// Saldo e status
// ---------------------------------------------------------------------------

test("saldo é o que falta pagar e nunca fica negativo", () => {
  assert.equal(remainingBalance(1000, 0), 1000);
  assert.equal(remainingBalance(1000, 400), 600);
  assert.equal(remainingBalance(1000, 1000), 0);
  assert.equal(remainingBalance(1000, 1200), 0, "pagamento a maior não vira saldo negativo");
});

test("saldo arredonda para centavos", () => {
  assert.equal(remainingBalance(100, 33.333), 66.67);
  assert.equal(remainingBalance(0.1 + 0.2, 0), 0.3, "sem resíduo de ponto flutuante");
});

test("pagamento parcial mantém o documento em aberto", () => {
  assert.equal(statusAfterPayments(1000, 0), FinanceStatus.PENDENTE);
  assert.equal(statusAfterPayments(1000, 1), FinanceStatus.PARCIAL);
  assert.equal(statusAfterPayments(1000, 999), FinanceStatus.PARCIAL);
  assert.equal(statusAfterPayments(1000, 1000), FinanceStatus.PAGO);
  assert.equal(statusAfterPayments(1000, 1500), FinanceStatus.PAGO);
});

test("diferença de um centavo por arredondamento de parcela quita o documento", () => {
  // 1000 em 3 parcelas de 333,33 = 999,99
  assert.equal(statusAfterPayments(1000, 999.99), FinanceStatus.PAGO);
  assert.equal(statusAfterPayments(1000, 999.98), FinanceStatus.PARCIAL, "dois centavos ainda é saldo em aberto");
});

test("documento em aberto é o que ainda consome caixa", () => {
  assert.equal(isOpen(FinanceStatus.PENDENTE), true);
  assert.equal(isOpen(FinanceStatus.PARCIAL), true);
  assert.equal(isOpen(FinanceStatus.PAGO), false);
  assert.equal(isOpen(FinanceStatus.CANCELADO), false);
});

// ---------------------------------------------------------------------------
// Validação do pagamento
// ---------------------------------------------------------------------------

test("pagamento acima do saldo é recusado com o valor certo na mensagem", () => {
  assert.throws(() => assertPaymentAmount(700, 1000, 400), (e: Error) => {
    assert.match(e.message, /600\.00/);
    return true;
  });
});

test("pagamento exato do saldo passa", () => {
  assert.doesNotThrow(() => assertPaymentAmount(600, 1000, 400));
});

test("um centavo de tolerância no pagamento final", () => {
  assert.doesNotThrow(() => assertPaymentAmount(600.01, 1000, 400));
  assert.throws(() => assertPaymentAmount(600.05, 1000, 400));
});

test("valor zero ou negativo é recusado", () => {
  assert.throws(() => assertPaymentAmount(0, 1000, 0), /maior que zero/);
  assert.throws(() => assertPaymentAmount(-50, 1000, 0), /maior que zero/);
});

test("documento já quitado não aceita mais pagamento", () => {
  assert.throws(() => assertPaymentAmount(10, 1000, 1000), /já está quitado/);
  assert.throws(() => assertPayable(FinanceStatus.PAGO), /já está quitado/);
});

test("documento cancelado não recebe pagamento", () => {
  assert.throws(() => assertPayable(FinanceStatus.CANCELADO), /cancelado/i);
});

test("pendente e parcial aceitam pagamento", () => {
  assert.doesNotThrow(() => assertPayable(FinanceStatus.PENDENTE));
  assert.doesNotThrow(() => assertPayable(FinanceStatus.PARCIAL));
});

// ---------------------------------------------------------------------------
// Situação derivada do vencimento
// ---------------------------------------------------------------------------

test("dias até o vencimento contam no calendário de Fortaleza", () => {
  assert.equal(daysUntilDue(dia("2026-09-18"), HOJE), 0, "vence hoje");
  assert.equal(daysUntilDue(dia("2026-09-21"), HOJE), 3);
  assert.equal(daysUntilDue(dia("2026-09-15"), HOJE), -3, "vencido há 3 dias");
});

test("vencimento na virada do dia não escorrega de fuso", () => {
  // 19/09 00:30 UTC ainda é 18/09 em Fortaleza (UTC-3)
  assert.equal(localDay(new Date("2026-09-19T00:30:00Z")), "2026-09-18");
  assert.equal(daysUntilDue(new Date("2026-09-19T00:30:00Z"), HOJE), 0, "ainda vence hoje, não amanhã");
});

const doc = (dueDate: Date | null, status: FinanceStatus = FinanceStatus.PENDENTE, alertDays: number | null = null) => ({ status, dueDate, alertDays });

test("vencido, próximo do vencimento e pendente, na antecedência padrão de 3 dias", () => {
  assert.equal(financeSituation(doc(dia("2026-09-15")), 3, HOJE), "VENCIDO");
  assert.equal(financeSituation(doc(dia("2026-09-18")), 3, HOJE), "A_VENCER", "vence hoje");
  assert.equal(financeSituation(doc(dia("2026-09-21")), 3, HOJE), "A_VENCER", "no limite da antecedência");
  assert.equal(financeSituation(doc(dia("2026-09-22")), 3, HOJE), "PENDENTE", "fora da janela de alerta");
});

test("a antecedência do próprio documento vence a configuração da loja", () => {
  const em7 = doc(dia("2026-09-25"), FinanceStatus.PENDENTE, 7);
  assert.equal(financeSituation(em7, 3, HOJE), "A_VENCER", "o documento pede 7 dias de aviso");
  assert.equal(financeSituation(doc(dia("2026-09-25")), 3, HOJE), "PENDENTE", "sem antecedência própria usa a da loja");
});

test("pago e cancelado encerram o documento, mesmo vencido", () => {
  assert.equal(financeSituation(doc(dia("2026-01-01"), FinanceStatus.PAGO), 3, HOJE), "PAGO");
  assert.equal(financeSituation(doc(dia("2026-01-01"), FinanceStatus.CANCELADO), 3, HOJE), "CANCELADO");
});

test("documento parcialmente pago e vencido aparece como vencido", () => {
  assert.equal(financeSituation(doc(dia("2026-09-10"), FinanceStatus.PARCIAL), 3, HOJE), "VENCIDO");
});

test("documento parcialmente pago e ainda longe do vencimento aparece como parcial", () => {
  assert.equal(financeSituation(doc(dia("2026-12-01"), FinanceStatus.PARCIAL), 3, HOJE), "PARCIAL");
});

test("documento sem vencimento nunca vence", () => {
  assert.equal(financeSituation(doc(null), 3, HOJE), "PENDENTE");
  assert.equal(financeSituation(doc(null, FinanceStatus.PARCIAL), 3, HOJE), "PARCIAL");
});

test("as seis situações da especificação têm rótulo", () => {
  assert.equal(FINANCE_SITUATIONS.length, 6);
  for (const s of FINANCE_SITUATIONS) assert.ok(SITUATION_LABEL[s]?.length > 2, `${s} sem rótulo`);
});

// ---------------------------------------------------------------------------
// Antecedência do alerta
// ---------------------------------------------------------------------------

test("só 1, 3, 5 e 7 dias são aceitos; o resto cai no padrão", () => {
  assert.deepEqual([...ALERT_DAY_OPTIONS], [1, 3, 5, 7]);
  for (const n of ALERT_DAY_OPTIONS) assert.equal(normalizeAlertDays(n), n);
  for (const ruim of [0, 2, 4, 30, -1, null, undefined, "abc", NaN]) {
    assert.equal(normalizeAlertDays(ruim), DEFAULT_ALERT_DAYS, `${ruim} deveria cair no padrão`);
  }
});

test("a configuração vem como texto do banco e é aceita", () => {
  assert.equal(normalizeAlertDays("7"), 7);
  assert.equal(normalizeAlertDays("3"), 3);
});

// ---------------------------------------------------------------------------
// Visão por dia, semana e mês
// ---------------------------------------------------------------------------

test("a semana começa na segunda-feira", () => {
  assert.equal(weekStart("2026-09-18"), "2026-09-14", "sexta -> segunda da mesma semana");
  assert.equal(weekStart("2026-09-14"), "2026-09-14", "segunda é o próprio início");
  assert.equal(weekStart("2026-09-20"), "2026-09-14", "domingo fecha a semana que começou na segunda");
});

test("o balde muda conforme a visão escolhida", () => {
  const d = dia("2026-09-18");
  assert.equal(dueBucket(d, "day"), "2026-09-18");
  assert.equal(dueBucket(d, "week"), "2026-09-14");
  assert.equal(dueBucket(d, "month"), "2026-09");
});

const d1 = { dueDate: dia("2026-09-18"), amount: 1000, paidAmount: 400 };
const d2 = { dueDate: dia("2026-09-16"), amount: 500, paidAmount: 0 };
const d3 = { dueDate: dia("2026-10-02"), amount: 300, paidAmount: 300 };
const semVencimento = { dueDate: null, amount: 999, paidAmount: 0 };

test("agrupa por mês somando valor e saldo", () => {
  const g = groupByDue([d1, d2, d3], "month");
  assert.deepEqual(g.map((x) => x.bucket), ["2026-09", "2026-10"]);
  assert.equal(g[0].total, 1500);
  assert.equal(g[0].remaining, 1100, "600 do parcial + 500 do pendente");
  assert.equal(g[1].remaining, 0, "outubro já está quitado");
});

test("dentro do balde, o vencimento mais próximo vem primeiro", () => {
  const g = groupByDue([d1, d2], "month");
  assert.deepEqual(g[0].items.map((i) => i.dueDate.toISOString().slice(0, 10)), ["2026-09-16", "2026-09-18"]);
});

test("os baldes saem em ordem do mais próximo para o mais distante", () => {
  const g = groupByDue([d3, d1], "week");
  assert.deepEqual(g.map((x) => x.bucket), ["2026-09-14", "2026-09-28"]);
});

test("documento sem vencimento fica fora do calendário", () => {
  const g = groupByDue([d1, semVencimento], "day");
  assert.equal(g.length, 1);
  assert.equal(g[0].items.length, 1);
});

test("lista vazia não quebra o agrupamento", () => {
  assert.deepEqual(groupByDue([], "week"), []);
});
