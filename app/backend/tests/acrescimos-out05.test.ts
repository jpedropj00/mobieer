/**
 * Acréscimos de 05/10: categorias e metas de investimento do financeiro,
 * presença do montador externo, projeto já em andamento e medidas da peça
 * que vai para a fábrica.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { StageStatus, TimelineStageKey } from "@prisma/client";
import { attendanceShiftTimes, attendanceTotals, daysBetween, localDayOf, weekOf } from "../src/modules/contractors/attendance.rules";
import { addCategory, goalProgress, goalsSummary, normalizeCategories, removeCategory, sortGoals, type InvestmentGoal } from "../src/modules/finance/finance-extras.rules";
import { partItemMeasures } from "../src/modules/parts/parts-production.rules";
import { startAtPlan } from "../src/modules/timeline/start-at.rules";

const goal = (over: Partial<InvestmentGoal>): InvestmentGoal => ({ id: "g", title: "Meta", cost: 1000, saved: 0, targetDate: null, notes: null, done: false, doneAt: null, createdAt: "2026-10-01T00:00:00Z", createdBy: "Ana", ...over });

test("categoria nova entra sem repetir as que já existem (na tela ou criadas)", () => {
  const base = normalizeCategories({ DESPESA: ["Uber"], RECEITA: "lixo" });
  assert.deepEqual(base, { RECEITA: [], DESPESA: ["Uber"] });
  const a = addCategory(base, "DESPESA", "  Marketing   digital ", ["Frete", "Outros"]);
  assert.equal(a.added, true);
  assert.deepEqual(a.categories.DESPESA, ["Uber", "Marketing digital"]);
  assert.equal(addCategory(a.categories, "DESPESA", "uber").added, false); // já criada
  assert.equal(addCategory(a.categories, "DESPESA", "FRETE", ["Frete"]).added, false); // já vem no sistema
  assert.equal(addCategory(a.categories, "RECEITA", "Uber").added, true); // receita e despesa são listas separadas
  assert.throws(() => addCategory(base, "DESPESA", "   "), /Informe o nome/);
  assert.deepEqual(removeCategory(a.categories, "DESPESA", "UBER").DESPESA, ["Marketing digital"]);
});

test("meta de investimento: quanto falta, percentual e totais do quadro", () => {
  assert.deepEqual(goalProgress(goal({ cost: 12000, saved: 3000 })), { remaining: 9000, percent: 25 });
  assert.deepEqual(goalProgress(goal({ cost: 500, saved: 900 })), { remaining: 0, percent: 100 }); // reservado nunca passa do custo
  assert.deepEqual(goalProgress(goal({ cost: 500, saved: 0, done: true })), { remaining: 0, percent: 100 });
  assert.deepEqual(goalProgress(goal({ cost: 0 })), { remaining: 0, percent: 0 });
  const s = goalsSummary([goal({ cost: 12000, saved: 3000 }), goal({ cost: 8000, saved: 0 }), goal({ cost: 5000, saved: 5000, done: true })]);
  assert.deepEqual(s, { open: 2, done: 1, planned: 20000, saved: 3000, remaining: 17000, doneValue: 5000 });
});

test("metas em aberto primeiro, pela data mais próxima; concluídas no fim", () => {
  const out = sortGoals([
    goal({ id: "feita", done: true, doneAt: "2026-09-01T00:00:00Z" }),
    goal({ id: "sem-data", createdAt: "2026-01-01T00:00:00Z" }),
    goal({ id: "dezembro", targetDate: "2026-12-01" }),
    goal({ id: "novembro", targetDate: "2026-11-01" }),
  ]);
  assert.deepEqual(out.map((g) => g.id), ["novembro", "dezembro", "sem-data", "feita"]);
});

test("presença: turno do dia lançado como 'veio' é 8h–17h em Fortaleza", () => {
  const t = attendanceShiftTimes("2026-10-05");
  assert.equal(t.checkInAt.toISOString(), "2026-10-05T11:00:00.000Z");
  assert.equal(t.checkOutAt.toISOString(), "2026-10-05T20:00:00.000Z");
  assert.equal(t.minutes, 540);
  assert.equal(localDayOf(new Date("2026-10-06T01:30:00Z")), "2026-10-05"); // 22h30 do dia 5 em Fortaleza
});

test("presença: semana de segunda a sábado e totais por montador", () => {
  assert.deepEqual(weekOf("2026-10-07"), { from: "2026-10-05", to: "2026-10-10" }); // quarta
  assert.deepEqual(weekOf("2026-10-11"), { from: "2026-10-05", to: "2026-10-10" }); // domingo fica na semana que passou
  const days = daysBetween("2026-10-05", "2026-10-10");
  assert.equal(days.length, 6);
  const totals = attendanceTotals(
    ["m1", "m2"],
    days,
    [
      { contractorId: "m1", date: "2026-10-05", present: true },
      { contractorId: "m1", date: "2026-10-06", present: false },
      { contractorId: "m2", date: "2026-10-05", present: false }, // escritório disse que não veio: vale o lançamento
    ],
    [
      { contractorId: "m1", date: "2026-10-07" }, // bateu o ponto sozinho: conta como presente
      { contractorId: "m2", date: "2026-10-05" },
    ]
  );
  assert.deepEqual(totals, [
    { contractorId: "m1", present: 2, absent: 1, none: 3 },
    { contractorId: "m2", present: 0, absent: 1, none: 5 },
  ]);
});

test("projeto já em andamento: conclui as anteriores, inicia a atual e nunca volta etapa", () => {
  const K = TimelineStageKey;
  const stages = Object.values(K).map((key) => ({ key, status: StageStatus.PENDENTE as StageStatus }));
  const p = startAtPlan(stages, K.PRODUCAO);
  assert.deepEqual(p.conclude, [K.LEAD, K.BRIEFING, K.ORCAMENTO, K.NEGOCIACAO, K.CONTRATO, K.PAGAMENTO_ENTRADA, K.MEDICAO, K.PROJETO_TECNICO, K.APROVACAO, K.TERMO_PRODUCAO]);
  assert.equal(p.start, K.PRODUCAO);
  assert.equal(p.productionStage, "IN_PRODUCTION");

  // o que já estava concluído ou "não se aplica" fica como está; etapa atual já em andamento não muda
  const mixed = stages.map((s) => (s.key === K.LEAD ? { ...s, status: StageStatus.CONCLUIDA } : s.key === K.BRIEFING ? { ...s, status: StageStatus.NAO_APLICAVEL } : s.key === K.MEDICAO ? { ...s, status: StageStatus.EM_ANDAMENTO } : s));
  const m = startAtPlan(mixed, K.MEDICAO);
  assert.deepEqual(m.conclude, [K.ORCAMENTO, K.NEGOCIACAO, K.CONTRATO, K.PAGAMENTO_ENTRADA]);
  assert.equal(m.start, null);
  assert.equal(m.productionStage, null); // antes da fábrica não nasce pedido de produção

  assert.equal(startAtPlan(stages, K.MONTAGEM).productionStage, "OUT_FOR_DELIVERY");
  assert.equal(startAtPlan(stages, K.VISTORIA).productionStage, "DELIVERED");
  assert.deepEqual(startAtPlan(stages, K.LEAD).conclude, []);
  assert.throws(() => startAtPlan(stages, K.GARANTIA), /Etapa inválida/);
});

test("medidas da peça para a etiqueta da fábrica", () => {
  assert.equal(partItemMeasures({ width: 600, height: "720.00", depth: null, thickness: 18 }), "600 × 720 × 18 mm");
  assert.equal(partItemMeasures({ width: 600.5, height: 720, depth: 560, thickness: null }), "600.5 × 720 × 560 mm");
  assert.equal(partItemMeasures({ width: null, height: null, depth: null, thickness: 15 }), "esp. 15 mm");
  assert.equal(partItemMeasures({ width: null, height: 0, depth: "", thickness: null }), null);
});
