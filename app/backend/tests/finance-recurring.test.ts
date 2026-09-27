/**
 * Despesas fixas: meses a lançar, vencimento no fim de mês e sem duplicar.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { addMonthKey, dueDayOf, monthsToGenerate } from "../src/modules/finance/recurring.rules";

test("vencimento: dia 31 vira o último dia do mês; fevereiro bissexto", () => {
  assert.equal(dueDayOf("2026-02", 31), "2026-02-28");
  assert.equal(dueDayOf("2028-02", 30), "2028-02-29");
  assert.equal(dueDayOf("2026-04", 31), "2026-04-30");
  assert.equal(dueDayOf("2026-05", 10), "2026-05-10");
});

test("virada de ano", () => {
  assert.equal(addMonthKey("2026-11", 3), "2027-02");
});

test("gera os próximos meses sem repetir os já lançados e respeitando o fim", () => {
  const t = { dayOfMonth: 5, startMonth: "2026-09", endMonth: "2026-12" };
  const r = monthsToGenerate(t, "2026-10", 12, new Set(["2026-11"]));
  assert.deepEqual(r, [{ month: "2026-10", dueDay: "2026-10-05" }, { month: "2026-12", dueDay: "2026-12-05" }]);
});

test("antes do início, começa no início; sem fim, gera a quantidade pedida", () => {
  const r = monthsToGenerate({ dayOfMonth: 20, startMonth: "2027-01", endMonth: null }, "2026-09", 3, new Set());
  assert.deepEqual(r.map((x) => x.month), ["2027-01", "2027-02", "2027-03"]);
});
