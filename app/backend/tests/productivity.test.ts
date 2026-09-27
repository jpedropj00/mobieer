/**
 * §5 — indicadores mensais: só dados reais, nada inventado onde não há registro.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { computeIndicators, factualSummary, goalProgress, hasData, hhmm, lastMonths, monthRange, previousMonth, type RawUserMonth } from "../src/modules/productivity/productivity.rules";

const range = monthRange("2026-09");
const now = new Date("2026-09-25T12:00:00");
const empty: RawUserMonth = { activities: [], timeLogs: [], stepsCompleted: 0, tasks: [], clock: null };

test("mês: intervalo, anterior e janela", () => {
  assert.equal(range.start.getMonth(), 8);
  assert.equal(range.end.getMonth(), 9);
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.deepEqual(lastMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  assert.throws(() => monthRange("2026-13"));
});

test("horário HH:MM", () => {
  assert.equal(hhmm("08:30"), 510);
  assert.equal(hhmm("8:05"), 485);
  assert.equal(hhmm("25:00"), null);
  assert.equal(hhmm(null), null);
});

test("sem registro: indicadores zerados/nulos e resumo diz que não há dado", () => {
  const i = computeIndicators(empty, range, now);
  assert.equal(hasData(i), false);
  assert.equal(i.onTimeRate, null);
  assert.equal(i.avgActivityMinutes, null);
  assert.equal(i.workedMinutes, null, "sem ponto importado não é zero hora trabalhada");
  assert.match(factualSummary("Ana", "2026-09", i, null, []).text, /não tem registros/);
});

test("atividades, fábrica, tarefas e ponto", () => {
  const raw: RawUserMonth = {
    activities: [
      { status: "COMPLETED", startTime: "08:00", endTime: "10:00" },
      { status: "COMPLETED", startTime: "13:00", endTime: "14:00" },
      { status: "COMPLETED", startTime: null, endTime: null },
      { status: "IN_PROGRESS", startTime: null, endTime: null },
    ],
    timeLogs: [
      { minutes: 90, itemId: "a", sector: "CORTE" },
      { minutes: 30, itemId: "b", sector: "CORTE" },
      { minutes: null, itemId: "c", sector: "FITA_BORDA" }, // cronômetro rodando
    ],
    stepsCompleted: 4,
    tasks: [
      { dueAt: new Date("2026-09-10"), completedAt: new Date("2026-09-09") }, // no prazo
      { dueAt: new Date("2026-09-10"), completedAt: new Date("2026-09-12") }, // atrasada
      { dueAt: null, completedAt: new Date("2026-09-15") }, // sem prazo
      { dueAt: new Date("2026-09-20"), completedAt: null }, // vencida aberta
      { dueAt: new Date("2026-09-28"), completedAt: null }, // ainda no prazo
    ],
    clock: { workedMinutes: 9600, overtimeMinutes: 120, faltas: 1 },
  };
  const i = computeIndicators(raw, range, now);
  assert.equal(i.activitiesDone, 3);
  assert.equal(i.activitiesOpen, 1);
  assert.equal(i.avgActivityMinutes, 90, "só conta atividade com início e fim");
  assert.equal(i.productionMinutes, 120);
  assert.equal(i.minutesPerStep, 30);
  assert.equal(i.tasksDone, 3);
  assert.equal(i.tasksDoneLate, 1);
  assert.equal(i.tasksOverdueOpen, 1, "a de 28/09 ainda não venceu");
  // 1 no prazo de 3 com prazo (2 concluídas com prazo + 1 vencida aberta)
  assert.equal(i.onTimeRate, 33);
  assert.equal(i.absences, 1);

  const g = goalProgress([{ metric: "PRODUCTION_STEPS", target: 8 }, { metric: "PRODUCTION_HOURS", target: 4 }], i);
  assert.deepEqual(g.map((x) => [x.actual, x.percent]), [[4, 50], [2, 50]]);

  const prev = computeIndicators({ ...raw, stepsCompleted: 2, timeLogs: [{ minutes: 40, itemId: "x", sector: "CORTE" }] }, monthRange("2026-08"), now);
  const s = factualSummary("Ana", "2026-09", i, prev, g);
  assert.match(s.text, /4 etapa\(s\) de peça concluída\(s\) na fábrica \(\+100% sobre o mês anterior\)/);
  assert.ok(s.bottlenecks.some((b) => b.includes("tarefa(s) com prazo vencido")));
  assert.ok(s.bottlenecks.some((b) => b.includes("tempo por etapa subiu de 20 para 30 min")));
  // nada de adjetivo sobre a pessoa
  assert.doesNotMatch(s.text, /ótim|bom|ruim|fraco|excelente/i);
});
