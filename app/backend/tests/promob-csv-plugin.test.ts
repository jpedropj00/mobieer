/**
 * CSV do plugin de corte do Promob (formato real da loja): uma linha por canto
 * da peça, linhas de agrupamento sem matéria-prima e o tamanho da chapa.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parsePromobCsv } from "../src/modules/promob/promob.csv";

const H = "PONTO X ITEM;PONTO Y ITEM;ACABAMENTO FITA BORDA;DESCRIÇÃO FITA BORDA;AMBIENTE;PEÇA ID;REFERÊNCIA;ID MÓDULO;PEÇA DESCRIÇÃO;ALTURA (X);PROF (Y);ESPESSURA ITEM;QUANTIDADE ITEM;ITEM TEM MATÉRIA PRIMA;DESCRIÇÃO DO MATERIAL;DIM_X_MATERIAL;DIM_Y_MATERIAL";
const canto = (x: string, y: string, id: string, fita: string, alt = "1000", prof = "500") =>
  `${x};${y};${fita ? "Carvalho" : ""};${fita};COZINHA;${id};PAI_esq;77;Painel__;${alt};${prof};15,5;1;1;Carvalho 15mm;2700;1800`;
const csv = (linhas: string[]) => Buffer.from("\uFEFF" + [H, ...linhas].join("\r\n"), "utf8");

test("quatro cantos viram uma peça; agrupamento sem matéria-prima fica de fora", () => {
  const p = parsePromobCsv(
    csv([
      canto("0", "500", "10", "19-0,45-Carvalho"),
      canto("0", "0", "10", "19-0,45-Carvalho"),
      canto("1000", "0", "10", "19-0,45-Carvalho"),
      canto("1000", "500", "10", "19-0,45-Carvalho"),
      ";;;;COZINHA;11;;77;Painel;1085;15,5;880;1;0;;;",
    ])
  );
  assert.equal(p.pecas.length, 1);
  const peca = p.pecas[0];
  assert.equal(peca.descricao, "Painel"); // sem o "__" do export
  assert.deepEqual([peca.comprimento, peca.largura, peca.espessura, peca.quantidade], [1000, 500, 15.5, 1]);
  assert.equal(peca.areaM2, 0.5);
  assert.equal(peca.fitaM, 3); // perímetro: os quatro lados têm fita
  assert.deepEqual(peca.chapa, { x: 2700, y: 1800 });
  assert.match(p.warnings.join(" "), /1 linha\(s\) de agrupamento/);
  assert.match(p.warnings.join(" "), /4 linhas viraram 1 peças/);
});

test("fita só nos lados que têm; chapas pela área com perda; total de fita por tipo", () => {
  const linhas = [
    // peça 1: fita em dois lados de 1000 mm
    canto("0", "500", "1", ""), canto("0", "0", "1", "FITA A"), canto("1000", "0", "1", ""), canto("1000", "500", "1", "FITA A"),
    // peça 2: sem fita
    canto("0", "500", "2", ""), canto("0", "0", "2", ""), canto("1000", "0", "2", ""), canto("1000", "500", "2", ""),
  ];
  const p = parsePromobCsv(csv(linhas));
  assert.equal(p.pecas.length, 2);
  assert.equal(p.pecas[0].fitaM, 2);
  assert.equal(p.pecas[1].fitaM, 0);
  assert.deepEqual(p.materiais, [{ material: "Carvalho 15mm", pecas: 2, areaM2: 1, chapaM2: 4.86, chapas: 1 }]);
  assert.deepEqual(p.fitas, [{ fita: "FITA A", metros: 2 }]);
});

test("CSV simples (uma linha por peça) continua funcionando", () => {
  const p = parsePromobCsv(Buffer.from("Peça;Qtde;Comprimento;Largura;Material\nLateral;2;700;550;MDF Branco\n", "utf8"));
  assert.equal(p.pecas.length, 1);
  assert.equal(p.pecas[0].quantidade, 2);
  assert.equal(p.pecas[0].areaM2, 0.77);
  assert.equal(p.materiais[0].chapas, null); // sem tamanho de chapa no arquivo, não estima
});
