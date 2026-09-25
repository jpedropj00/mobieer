/**
 * §19/§20 — CSV do Promob: separador, codificação, cabeçalho por sinônimos,
 * medidas em formato BR, agregação por material e escolha do adapter.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeText, detectDelimiter, mapHeader, parsePromobCsv, splitCsv } from "../src/modules/promob/promob.csv";
import { detectPromobFormat, readPromobFile } from "../src/modules/promob/promob.adapters";

const CSV = [
  "Ambiente;Módulo;Peça;Qtde;Comprimento;Largura;Espessura;Material;Fita",
  "Cozinha;Aéreo 1;Lateral;2;700;320;18;MDF Branco TX;1C",
  "Cozinha;Aéreo 1;Porta;2;696;396;18;MDF Carvalho;4L",
  'Dormitório;Roupeiro;"Prateleira; reforçada";3;"1.200";500;18;MDF Branco TX;1L',
  "Cozinha;;;1;100;100;18;MDF;",
].join("\r\n");

test("separador pela primeira linha, ignorando o que está entre aspas", () => {
  assert.equal(detectDelimiter("a;b;c"), ";");
  assert.equal(detectDelimiter("a,b,c"), ",");
  assert.equal(detectDelimiter("a\tb\tc"), "\t");
  assert.equal(detectDelimiter('"x,y,z";b;c'), ";");
});

test("aspas guardam separador e aspas duplas", () => {
  assert.deepEqual(splitCsv('a;"b;c";"d ""e"""\n1;2;3', ";"), [["a", "b;c", 'd "e"'], ["1", "2", "3"]]);
});

test("cabeçalho casa por sinônimo, sem acento e sem caixa", () => {
  const { map, unknown } = mapHeader(["Peça", "QTDE", "Compr.", "Larg", "Chapa", "Observação"]);
  assert.deepEqual(map, { descricao: 0, quantidade: 1, comprimento: 2, largura: 3, material: 4 });
  assert.deepEqual(unknown, ["Observação"]);
});

test("Windows-1252 sem BOM é decodificado", () => {
  assert.equal(decodeText(Buffer.from("Peça;Módulo", "latin1")), "Peça;Módulo");
  assert.equal(decodeText(Buffer.from("﻿Peça", "utf8")), "Peça");
});

test("lê peças, medidas BR e agrega área por material", () => {
  const r = parsePromobCsv(Buffer.from(CSV, "utf8"));
  assert.equal(r.pecas.length, 3);
  assert.equal(r.pecas[2].descricao, "Prateleira; reforçada");
  assert.equal(r.pecas[2].comprimento, 1200);
  assert.deepEqual(r.ambientes, ["Cozinha", "Dormitório"]);
  const branco = r.materiais.find((m) => m.material === "MDF Branco TX")!;
  // 2 × 0,700 × 0,320 + 3 × 1,200 × 0,500 = 0,448 + 1,8
  assert.equal(branco.areaM2, 2.248);
  assert.equal(branco.pecas, 5);
  assert.equal(r.columns.delimiter, ";");
  assert.equal(r.columns.recognized.borda, "Fita");
  // formato que o resto do sistema consome
  assert.equal(r.itens[0].descricao, "Aéreo 1 — Lateral");
  assert.equal(r.itens[0].quantidade, 2);
  assert.ok(r.warnings.some((w) => w.includes("sem descrição")));
});

test("sem coluna de descrição, o erro diz quais colunas vieram", () => {
  assert.throws(() => parsePromobCsv(Buffer.from("A;B\n1;2")), /Colunas do arquivo: A, B/);
});

test("sem quantidade conta 1 e avisa", () => {
  const r = parsePromobCsv(Buffer.from("Descrição,Material\nTampo,MDP"));
  assert.equal(r.pecas[0].quantidade, 1);
  assert.ok(r.warnings.some((w) => w.includes("quantidade")));
});

test("adapter pelo formato; falha de leitura vira PARSE_FAILED com motivo", () => {
  assert.equal(detectPromobFormat("plano.CSV", ""), "CSV");
  assert.equal(detectPromobFormat("orc.xml", ""), "XML");
  assert.equal(detectPromobFormat("orc.pdf", ""), "PDF");
  assert.equal(detectPromobFormat("x.bin", ""), "OTHER");
  const ok = readPromobFile({ buffer: Buffer.from(CSV), originalname: "p.csv", mimetype: "text/csv" });
  assert.equal(ok.status, "PARSED");
  assert.equal(ok.itemCount, 3);
  const bad = readPromobFile({ buffer: Buffer.from("A;B\n1;2"), originalname: "p.csv", mimetype: "text/csv" });
  assert.equal(bad.status, "PARSE_FAILED");
  assert.match(bad.notes!, /descrição/);
});
