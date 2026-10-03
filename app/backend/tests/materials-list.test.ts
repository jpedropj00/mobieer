/**
 * Lista de materiais a comprar: chapas por ambiente a partir do Promob,
 * e a marcação de comprado que sobrevive a uma nova leitura do arquivo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EDGE_ROOM, NO_ROOM, draftsFromPromob, groupByRoom, mergeDrafts, qtyText, summary, type MaterialLine } from "../src/modules/production/materials-list.rules";

const chapa = { x: 2750, y: 1850 }; // 5,0875 m²

test("chapas por ambiente e material, com a perda de corte, e as fitas em metros", () => {
  const d = draftsFromPromob({
    pecas: [
      { material: "Carvalho Treviso", ambiente: "Sala", areaM2: 20, chapa },
      { material: "Carvalho Treviso", ambiente: "Sala", areaM2: 10, chapa },
      { material: "Branco TX 15mm", ambiente: "Sala", areaM2: 4, chapa },
      { material: "Branco TX 15mm", ambiente: "Cozinha", areaM2: 5, chapa },
      { material: null, ambiente: "Sala", areaM2: 3 },
    ],
    fitas: [{ fita: "Fita Carvalho 22mm", metros: 41.2 }],
  });
  assert.deepEqual(d, [
    { room: "Sala", material: "Carvalho Treviso", qty: 7, unit: "chapa" }, // 30 × 1,1 / 5,0875 = 6,49
    { room: "Sala", material: "Branco TX 15mm", qty: 1, unit: "chapa" },
    { room: "Cozinha", material: "Branco TX 15mm", qty: 2, unit: "chapa" },
    { room: EDGE_ROOM, material: "Fita Carvalho 22mm", qty: 42, unit: "m" },
  ]);
});

test("sem tamanho da chapa a quantidade fica em branco; sem peças usa o resumo por material", () => {
  assert.deepEqual(draftsFromPromob({ pecas: [{ material: "Palha", ambiente: null, areaM2: 6 }] }), [{ room: NO_ROOM, material: "Palha", qty: null, unit: "chapa" }]);
  assert.deepEqual(draftsFromPromob({ materiais: [{ material: "Viena", areaM2: 9, chapas: 3 }] }), [{ room: NO_ROOM, material: "Viena", qty: 3, unit: "chapa" }]);
  assert.deepEqual(draftsFromPromob(null), []);
});

test("reler o Promob mantém o que já foi comprado e o que foi digitado à mão", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const existing: MaterialLine[] = [
    { id: "a", room: "Sala", material: "Carvalho Treviso", qty: 7, unit: "chapa", bought: true, source: "PROMOB" },
    { id: "b", room: "Sala", material: "Palha", qty: 3, unit: "chapa", bought: false, source: "PROMOB" },
    { id: "c", room: "Sala", material: "Proá", qty: null, unit: "un", bought: false, source: "MANUAL" },
    { id: "d", room: "Cozinha", material: "Duna Fosco", qty: 1, unit: "chapa", bought: true, source: "PROMOB" },
  ];
  const out = mergeDrafts(
    existing,
    [
      { room: "sala", material: "CARVALHO TREVISO", qty: 9, unit: "chapa" }, // já comprado: não mexe
      { room: "Sala", material: "Branco TX 6mm", qty: 2, unit: "chapa" }, // novo
    ],
    id
  );
  assert.deepEqual(out.map((l) => [l.id, l.material, l.qty, l.bought]), [
    ["a", "Carvalho Treviso", 7, true],
    ["c", "Proá", null, false], // manual fica
    ["d", "Duna Fosco", 1, true], // sumiu do arquivo, mas já foi comprado
    ["n1", "Branco TX 6mm", 2, false],
  ]);
  // linha pendente que continua no arquivo recebe a quantidade nova
  const upd = mergeDrafts([existing[1]], [{ room: "Sala", material: "Palha", qty: 5, unit: "chapa" }], id);
  assert.equal(upd[0].qty, 5);
});

test("resumo, agrupamento por ambiente (fitas por último) e texto da quantidade", () => {
  const lines: MaterialLine[] = [
    { id: "1", room: EDGE_ROOM, material: "Fita", qty: 40, unit: "m", bought: false, source: "PROMOB" },
    { id: "2", room: "Sala", material: "A", qty: 1, unit: "chapa", bought: true, source: "PROMOB" },
    { id: "3", room: "Quarto Master", material: "B", qty: 2, unit: "chapa", bought: false, source: "PROMOB" },
    { id: "4", room: "sala", material: "C", qty: null, unit: "un", bought: true, source: "MANUAL" },
  ];
  assert.deepEqual(summary(lines), { total: 4, bought: 2, pending: 2, done: false });
  assert.deepEqual(summary([]), { total: 0, bought: 0, pending: 0, done: false });
  assert.deepEqual(groupByRoom(lines).map((g) => [g.room, g.lines.length]), [["Sala", 2], ["Quarto Master", 1], [EDGE_ROOM, 1]]);
  assert.deepEqual(lines.map(qtyText), ["40 m", "1 chapa", "2 chapas", ""]);
});
