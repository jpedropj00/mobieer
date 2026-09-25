/**
 * §23/§24 — Etapas do pedido na fábrica: prazos em cascata, configuração,
 * transições e o aviso que cada etapa merece.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STEP_DAYS,
  STEP_ORDER,
  addBusinessDays,
  daysLate,
  nextStepStatus,
  parseStepDays,
  planDueDates,
  stepAlert,
} from "../src/modules/production/steps.rules";
import { impliedStage, stepsDoneByStage } from "../src/modules/production/steps.service";

const d = (s: string) => new Date(`${s}T12:00:00`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

test("dias úteis pulam fim de semana", () => {
  // sexta + 1 dia útil = segunda
  assert.equal(iso(addBusinessDays(d("2026-09-25"), 1)), "2026-09-28");
  assert.equal(iso(addBusinessDays(d("2026-09-25"), 0)), "2026-09-25");
  assert.equal(iso(addBusinessDays(d("2026-09-21"), 5)), "2026-09-28");
});

test("prazos em cascata seguem a ordem das etapas", () => {
  const due = planDueDates(d("2026-09-21"), DEFAULT_STEP_DAYS);
  for (let i = 1; i < STEP_ORDER.length; i++) {
    assert.ok(due[STEP_ORDER[i]].getTime() >= due[STEP_ORDER[i - 1]].getTime(), STEP_ORDER[i]);
  }
  // segunda + 1 = terça (plano de corte), + 2 = quinta (corte)
  assert.equal(iso(due.PLANO_CORTE), "2026-09-22");
  assert.equal(iso(due.CORTE), "2026-09-24");
});

test("configuração aceita só chaves e valores válidos", () => {
  const cfg = parseStepDays(JSON.stringify({ CORTE: 5, LIMPEZA: -1, FOO: 3, EMBALAGEM: 2.5 }));
  assert.equal(cfg.CORTE, 5);
  assert.equal(cfg.LIMPEZA, DEFAULT_STEP_DAYS.LIMPEZA);
  assert.equal(cfg.EMBALAGEM, DEFAULT_STEP_DAYS.EMBALAGEM);
  assert.deepEqual(parseStepDays("{quebrado"), DEFAULT_STEP_DAYS);
  assert.deepEqual(parseStepDays(null), DEFAULT_STEP_DAYS);
});

test("transições da etapa", () => {
  assert.deepEqual(nextStepStatus("PENDING", "START"), { ok: true, status: "IN_PROGRESS" });
  assert.deepEqual(nextStepStatus("PENDING", "COMPLETE"), { ok: true, status: "DONE" });
  assert.deepEqual(nextStepStatus("IN_PROGRESS", "BLOCK"), { ok: true, status: "BLOCKED" });
  assert.equal(nextStepStatus("BLOCKED", "COMPLETE").ok, false);
  assert.deepEqual(nextStepStatus("BLOCKED", "UNBLOCK"), { ok: true, status: "IN_PROGRESS" });
  assert.equal(nextStepStatus("IN_PROGRESS", "SKIP").ok, false);
  assert.deepEqual(nextStepStatus("DONE", "REOPEN"), { ok: true, status: "IN_PROGRESS" });
  assert.equal(nextStepStatus("DONE", "START").ok, false);
});

test("aviso: próximo, vencido e sem repetição no mesmo dia", () => {
  const now = d("2026-09-25");
  const base = { status: "IN_PROGRESS" as const, lastAlertKind: null, lastAlertAt: null };
  assert.equal(stepAlert({ ...base, dueAt: new Date(now.getTime() + 3_600_000) }, now), "DUE_SOON");
  assert.equal(stepAlert({ ...base, dueAt: new Date(now.getTime() - 3_600_000) }, now), "OVERDUE");
  assert.equal(stepAlert({ ...base, dueAt: new Date(now.getTime() + 3 * 86_400_000) }, now), null);
  // mesmo aviso há 2h: não repete
  assert.equal(stepAlert({ ...base, dueAt: new Date(now.getTime() - 3_600_000), lastAlertKind: "OVERDUE", lastAlertAt: new Date(now.getTime() - 7_200_000) }, now), null);
  // passou de "próximo" para "vencido": avisa na hora
  assert.equal(stepAlert({ ...base, dueAt: new Date(now.getTime() - 3_600_000), lastAlertKind: "DUE_SOON", lastAlertAt: new Date(now.getTime() - 7_200_000) }, now), "OVERDUE");
  // concluída não avisa
  assert.equal(stepAlert({ ...base, status: "DONE", dueAt: new Date(now.getTime() - 3_600_000) }, now), null);
});

test("dias de atraso só para etapa aberta", () => {
  const now = d("2026-09-25");
  assert.equal(daysLate(d("2026-09-22"), "IN_PROGRESS", now), 3);
  assert.equal(daysLate(d("2026-09-22"), "DONE", now), 0);
  assert.equal(daysLate(d("2026-09-28"), "PENDING", now), 0);
});

test("etapa da fábrica leva a esteira macro adiante", () => {
  assert.equal(impliedStage("CORTE", "START"), "IN_PRODUCTION");
  assert.equal(impliedStage("PRE_MONTAGEM", "START"), "PRE_ASSEMBLY");
  assert.equal(impliedStage("SAIDA", "COMPLETE"), "OUT_FOR_DELIVERY");
  assert.equal(impliedStage("SAIDA", "START"), null);
  assert.equal(impliedStage("LIMPEZA", "COMPLETE"), null);
});

test("pedido antigo: etapas que a esteira já passou nascem concluídas", () => {
  assert.deepEqual(stepsDoneByStage("RELEASED"), []);
  assert.deepEqual(stepsDoneByStage("IN_PRODUCTION"), []);
  assert.deepEqual(stepsDoneByStage("PRE_ASSEMBLY"), ["PLANO_CORTE", "CORTE", "FITA_BORDA", "PECAS_ESPECIAIS", "LIMPEZA", "EMBALAGEM"]);
  assert.equal(stepsDoneByStage("OUT_FOR_DELIVERY").length, STEP_ORDER.length);
});
