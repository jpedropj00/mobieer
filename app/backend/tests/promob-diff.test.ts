/**
 * Comparação de listas de peças do Promob: iguais, alteradas, excluídas, novas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { diffParts, partsFromParsed, type ComparablePart } from "../src/modules/promob/promob.diff";

const part = (o: Partial<ComparablePart>): ComparablePart => ({
  ambiente: "Cozinha", modulo: null, descricao: "Lateral", referencia: null, quantidade: 1,
  comprimento: 700, largura: 550, espessura: 18, material: "MDF Branco", borda: null, valor: null, ...o,
});

test("iguais, alteradas (com o que mudou), excluídas e novas", () => {
  const before = [
    part({ referencia: "L01" }),
    part({ referencia: "P01", descricao: "Porta", largura: 400 }),
    part({ referencia: "PR1", descricao: "Prateleira" }),
  ];
  const after = [
    part({ referencia: "L01" }),
    part({ referencia: "P01", descricao: "Porta", largura: 450, material: "MDF Carvalho" }),
    part({ referencia: "G01", descricao: "Gaveta" }),
  ];
  const d = diffParts(before, after);
  assert.deepEqual(d.summary, { iguais: 1, alteradas: 1, excluidas: 1, novas: 1 });
  const alt = d.rows.find((r) => r.status === "ALTERADA")!;
  assert.equal(alt.referencia, "P01");
  assert.deepEqual(alt.changes.map((c) => [c.label, c.before, c.after]), [["Largura", 400, 450], ["Material", "MDF Branco", "MDF Carvalho"]]);
  assert.equal(d.rows[0].status, "ALTERADA"); // o que precisa de atenção vem primeiro
});

test("sem referência: casa por ambiente + módulo + descrição, ignorando acento e caixa", () => {
  const d = diffParts([part({ descricao: "Lateral Direita", ambiente: "Dormitório" })], [part({ descricao: "lateral  direita", ambiente: "dormitorio" })]);
  assert.deepEqual(d.summary, { iguais: 1, alteradas: 0, excluidas: 0, novas: 0 });
});

test("referência repetida é pareada na ordem do arquivo", () => {
  const d = diffParts([part({ referencia: "X", largura: 100 }), part({ referencia: "X", largura: 200 })], [part({ referencia: "X", largura: 100 }), part({ referencia: "X", largura: 250 })]);
  assert.deepEqual(d.summary, { iguais: 1, alteradas: 1, excluidas: 0, novas: 0 });
});

test("mesmo nome em ambientes diferentes são peças diferentes", () => {
  const d = diffParts([part({ ambiente: "Cozinha" })], [part({ ambiente: "Lavanderia" })]);
  assert.deepEqual(d.summary, { iguais: 0, alteradas: 0, excluidas: 1, novas: 1 });
});

test("parsedJson de CSV (pecas) e de XML (itens)", () => {
  const csv = partsFromParsed({ pecas: [{ descricao: "Base", quantidade: 2, comprimento: 800, ambiente: "Cozinha", referencia: "B1", valor: 90 }] });
  assert.equal(csv[0].comprimento, 800);
  assert.equal(csv[0].quantidade, 2);
  const xml = partsFromParsed({ itens: [{ descricao: "Armário aéreo", quantidade: 1, ambiente: "Cozinha", referencia: "A1", valorTotal: 1200 }] });
  assert.equal(xml[0].valor, 1200);
  assert.equal(xml[0].comprimento, null);
  assert.deepEqual(partsFromParsed(null), []);
});
