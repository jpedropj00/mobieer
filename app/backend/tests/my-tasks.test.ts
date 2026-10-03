/**
 * Minhas tarefas: agrupamento por prazo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { groupMyTasks, myTasksWhere } from "../src/modules/organization/my-tasks.rules";

// 10/10/2026, 15h em Fortaleza
const now = new Date("2026-10-10T18:00:00Z");
const t = (id: string, dueAt: string | null, completedAt: string | null = null) => ({ id, dueAt: dueAt ? new Date(dueAt) : null, completedAt: completedAt ? new Date(completedAt) : null });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("toda tarefa em aberto cai em um grupo — a sem prazo não some", () => {
  const g = groupMyTasks([t("atrasada", "2026-10-08T15:00:00Z"), t("hoje-cedo", "2026-10-10T12:00:00Z"), t("hoje-tarde", "2026-10-10T22:00:00Z"), t("amanha", "2026-10-11T15:00:00Z"), t("sem-prazo", null), t("feita", "2026-10-01T15:00:00Z", "2026-10-02T15:00:00Z")], now);
  assert.deepEqual(ids(g.overdue), ["atrasada"]);
  assert.deepEqual(ids(g.today), ["hoje-cedo", "hoje-tarde"]); // a de hoje cedo ainda é de hoje, não "atrasada"
  assert.deepEqual(ids(g.upcoming), ["amanha"]);
  assert.deepEqual(ids(g.noDate), ["sem-prazo"]);
  assert.deepEqual(ids(g.completed), ["feita"]);
});

test("o dia é o de Fortaleza: 23h do dia 10 lá já é dia 11 em UTC, mas continua 'hoje'", () => {
  const g = groupMyTasks([t("noite", "2026-10-11T02:00:00Z"), t("madrugada-seguinte", "2026-10-11T04:00:00Z")], now);
  assert.deepEqual(ids(g.today), ["noite"]);
  assert.deepEqual(ids(g.upcoming), ["madrugada-seguinte"]);
});

test("concluídas: as 20 mais recentes primeiro", () => {
  const many = Array.from({ length: 25 }, (_, i) => t(`c${i}`, null, new Date(Date.UTC(2026, 8, i + 1)).toISOString()));
  const g = groupMyTasks(many, now);
  assert.equal(g.completed.length, 20);
  assert.equal(g.completed[0].id, "c24");
  assert.equal(g.noDate.length, 0);
});

test("são minhas: responsável, participante, subtarefa em aberto ou criada por mim sem responsável", () => {
  assert.deepEqual(myTasksWhere("u1").OR, [
    { assigneeId: "u1" },
    { participants: { some: { userId: "u1" } } },
    { subtasks: { some: { assigneeId: "u1", completed: false } } },
    { assigneeId: null, createdById: "u1" },
  ]);
});
