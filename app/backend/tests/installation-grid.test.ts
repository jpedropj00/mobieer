/**
 * Grade de montagem: dias ocupados, ajudantes e conflitos.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGrid, crewConflicts, type GridOrder } from "../src/modules/contractors/grid.rules";

const o = (over: Partial<GridOrder>): GridOrder => ({ id: "o1", number: "OS-00001", status: "OPEN", kind: "MONTAGEM", contractorId: "m1", helperIds: [], startDay: "2026-09-28", days: 1, label: "402-1", ...over });

test("requisição de 2 dias ocupa titular e ajudante nos dois dias", () => {
  const g = buildGrid([{ id: "m1" }, { id: "a1" }, { id: "m2" }], [o({ days: 2, helperIds: ["a1"] })], "2026-09-28", 3);
  assert.deepEqual(g.days, ["2026-09-28", "2026-09-29", "2026-09-30"]);
  const row = (id: string) => g.rows.find((r) => r.contractorId === id)!;
  assert.deepEqual(row("m1").cells.map((c) => c.items.length), [1, 1, 0]);
  assert.equal(row("a1").cells[1].items[0].role, "AJUDANTE");
  assert.deepEqual(row("m2").cells.map((c) => c.items.length), [0, 0, 0]);
  assert.equal(g.conflicts, 0);
});

test("mesma pessoa em duas montagens no dia é conflito; cancelada não conta", () => {
  const g = buildGrid([{ id: "m1" }], [o({}), o({ id: "o2", number: "OS-00002", startDay: "2026-09-28" })], "2026-09-28", 1);
  assert.equal(g.rows[0].cells[0].conflict, true);
  assert.equal(g.conflicts, 1);
  const g2 = buildGrid([{ id: "m1" }], [o({}), o({ id: "o2", status: "CANCELLED" })], "2026-09-28", 1);
  assert.equal(g2.conflicts, 0);
});

test("montagem que começou antes da janela aparece só nos dias visíveis", () => {
  const g = buildGrid([{ id: "m1" }], [o({ startDay: "2026-09-26", days: 3 })], "2026-09-28", 2);
  assert.deepEqual(g.rows[0].cells.map((c) => c.items.length), [1, 0]);
});

test("conflitos da equipe ao agendar: ajudante ocupado em outra obra", () => {
  const target = { id: "novo", contractorId: "m2", helperIds: ["a1"], startDay: "2026-09-29", days: 2 };
  const c = crewConflicts(target, [o({ days: 2, helperIds: ["a1"] }), o({ id: "o3", number: "OS-00003", contractorId: "m9", startDay: "2026-10-05" })]);
  assert.deepEqual(c, [{ personId: "a1", day: "2026-09-29", number: "OS-00001" }]);
});
