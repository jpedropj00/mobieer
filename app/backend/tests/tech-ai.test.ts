/**
 * Caminho da IA no projeto técnico: o móvel em dados e a instrução para a IA de imagem.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeColumns, techAiBrief, techAiPrompt } from "../src/modules/techproject/tech-ai.rules";
import type { DrawingSpec } from "../src/modules/techproject/tech-drawing.rules";

const spec: DrawingSpec = {
  description: "Armário com caixaria em MDF cinza urban",
  width: 2540,
  height: 2380,
  depth: 550,
  top: 50,
  base: 70,
  specs: ["Puxador cava"],
  columns: [
    { kind: "PRATELEIRAS", width: 1360, count: 5, heights: [], label: null },
    { kind: "PORTAS", width: null, count: 2, shelves: 3, heights: [], label: null, note: "Portas de giro em alumínio prata" },
  ],
};
const ctx = { client: "Cliente de Exemplo", room: "Suíte" };

test("IA do projeto técnico: o resumo traz medidas e colunas como foram digitadas", () => {
  const b = techAiBrief(spec, ctx);
  assert.deepEqual(b.medidas_mm, { largura: 2540, altura: 2380, profundidade: 550, roda_teto: 50, rodape: 70, fechamento_esquerdo: 0, fechamento_direito: 0, espessura_chapa: 15.5 });
  assert.equal(b.colunas.length, 2);
  assert.deepEqual({ ...b.colunas[0], trechos: b.colunas[0].trechos.map((t) => ({ ...t, alturas_mm: t.alturas_mm.length })) }, {
    posicao: 1,
    largura_mm: 1360,
    observacao: null,
    trechos: [{ tipo: "prateleiras", nome: null, altura_mm: 2260, portas: 0, prateleiras: 5, gavetas: 0, alturas_mm: 6 }],
  });
  const portas = b.colunas[1];
  assert.deepEqual({ largura: portas.largura_mm, obs: portas.observacao, tipo: portas.trechos[0].tipo, portas: portas.trechos[0].portas, prateleiras: portas.trechos[0].prateleiras }, { largura: 1180, obs: "Portas de giro em alumínio prata", tipo: "portas", portas: 2, prateleiras: 3 });
  assert.deepEqual(describeColumns(b), [
    "Coluna 1 (1360 mm de largura): nicho aberto com 5 prateleiras.",
    "Coluna 2 (1180 mm de largura): 2 portas de abrir, com 3 prateleiras por dentro — Portas de giro em alumínio prata.",
  ]);
});

test("IA do projeto técnico: a instrução fixa as medidas e proíbe inventar", () => {
  const fechado = techAiPrompt(spec, ctx, "FECHADO");
  assert.match(fechado, /com as portas fechadas/);
  assert.match(fechado, /Largura 2540 mm, altura 2380 mm, profundidade 550 mm/);
  assert.match(fechado, /Não acrescente, não remova e não mova nada/);
  assert.match(fechado, /Nenhum texto na imagem/);
  assert.match(fechado, /Puxador cava/);
  assert.ok(!/Pedido da equipe/.test(fechado));
  const aberto = techAiPrompt(spec, ctx, "ABERTO", "  madeira   mais clara ");
  assert.match(aberto, /todas as portas abertas/);
  assert.match(aberto, /Pedido da equipe: madeira mais clara$/);
  // o pedido livre tem teto, para não virar uma instrução inteira no lugar da fixa
  assert.ok(techAiPrompt(spec, ctx, "FECHADO", "x".repeat(5000)).length < fechado.length + 700);
});

test("IA do projeto técnico: coluna com mais de um trecho é descrita de cima para baixo", () => {
  const b = techAiBrief(
    { ...spec, columns: [{ kind: "MALEIRO", width: null, count: 0, heights: [], label: null, parts: [
      { kind: "MALEIRO", count: 0, heights: [], label: null, height: 400 },
      { kind: "PRATELEIRAS", count: 2, heights: [], label: null, height: null },
      { kind: "GAVETAS", count: 4, heights: [], label: null, height: 800 },
    ] }] },
    ctx
  );
  assert.deepEqual(b.colunas[0].trechos.map((t) => t.tipo), ["maleiro", "prateleiras", "gavetas"]);
  assert.deepEqual(b.colunas[0].trechos.map((t) => t.altura_mm), [400, 1029, 800]); // 2260 - 400 - 800 - 2 chapas de 15,5
  assert.equal(describeColumns(b)[0], "Coluna 1 (2540 mm de largura): de cima para baixo: maleiro (compartimento alto para malas) (400 mm de altura); nicho aberto com 2 prateleiras (1029 mm de altura); 4 gavetas (800 mm de altura).");
});
