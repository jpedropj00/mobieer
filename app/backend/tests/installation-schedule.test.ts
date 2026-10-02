/**
 * Cronograma de montagem: semanas, dias úteis, vistoria e finais de semana.
 * Caso de referência: o cronograma da Juliana (01/07 a 24/07/2026).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, buildWeeks, durationText, inspectionDate, weekLabel, weekendsBetween } from "../src/modules/production/installation-schedule.rules";

test("semanas de 01/07 a 24/07/2026: 3 + 5 + 5 + 5 dias úteis, como na planilha", () => {
  const w = buildWeeks("2026-07-01", "2026-07-24");
  assert.deepEqual(w.map((x) => [x.from, x.to, x.businessDays]), [
    ["2026-07-01", "2026-07-03", 3],
    ["2026-07-06", "2026-07-10", 5],
    ["2026-07-13", "2026-07-17", 5],
    ["2026-07-20", "2026-07-24", 5],
  ]);
  assert.equal(w[0].label, "SEMANA DE 01 A 03 DE JULHO (3 DIAS ÚTEIS)");
  assert.equal(w.reduce((s, x) => s + x.businessDays, 0), 18); // "18 dias trabalhados"
  assert.equal(weekendsBetween("2026-07-01", "2026-07-24"), 3); // "3 finais de semana"
  assert.equal(inspectionDate("2026-07-24"), "2026-07-27"); // sexta → segunda
  assert.equal(durationText(w.length), "4 SEMANAS");
});

test("feriado não conta como dia útil e a semana que vira o mês ganha os dois meses no rótulo", () => {
  const w = buildWeeks("2026-08-27", "2026-09-09", new Set(["2026-09-07"]));
  assert.deepEqual(w.map((x) => x.businessDays), [2, 5, 2]);
  assert.equal(w[1].label, "SEMANA DE 31 DE AGOSTO A 04 DE SETEMBRO (5 DIAS ÚTEIS)");
  assert.equal(weekLabel("2026-09-08", "2026-09-08", 1), "SEMANA DO DIA 08 DE SETEMBRO (1 DIA ÚTIL)");
  assert.equal(inspectionDate("2026-09-04", new Set(["2026-09-07"])), "2026-09-08");
});

test("fim sugerido por dias úteis e período invertido não gera semana", () => {
  assert.equal(addBusinessDays("2026-07-01", 18), "2026-07-24");
  assert.equal(addBusinessDays("2026-07-03", 1), "2026-07-03");
  assert.deepEqual(buildWeeks("2026-07-10", "2026-07-01"), []);
});
