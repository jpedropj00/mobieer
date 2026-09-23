/**
 * Exportação CSV (§59): formato que o Excel pt-BR abre certo, e as armadilhas
 * de escape que estragam um arquivo silenciosamente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CSV_BOM, csvCell, csvFileName, toCsv } from "../src/utils/csv";

type Linha = { nome: string; valor: number; data: Date | null };

const colunas = [
  { header: "Nome", value: (r: Linha) => r.nome },
  { header: "Valor", value: (r: Linha) => r.valor },
  { header: "Data", value: (r: Linha) => r.data },
];

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

test("começa com BOM, senão o Excel estraga os acentos", () => {
  const csv = toCsv([{ nome: "Produção", valor: 1, data: null }], colunas);
  assert.equal(csv.startsWith(CSV_BOM), true);
  assert.match(csv, /Produção/);
});

test("separa por ; e quebra linha com CRLF", () => {
  const csv = toCsv([{ nome: "A", valor: 2, data: null }], colunas);
  const linhas = csv.slice(CSV_BOM.length).split("\r\n");
  assert.equal(linhas[0], "Nome;Valor;Data");
  assert.equal(linhas[1], "A;2;");
});

test("número sai com vírgula decimal", () => {
  // "1250.5" no Excel pt-BR não é número
  assert.equal(csvCell(1250.5), "1250,5");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(-3.25), "-3,25");
});

test("data sai no fuso da loja", () => {
  // 2026-06-05T23:30Z é dia 5 às 20:30 em Fortaleza
  const c = csvCell(new Date("2026-06-05T23:30:00.000Z"));
  assert.match(c, /^05\/06\/2026/);
  assert.match(c, /20:30/);
});

test("célula vazia para nulo e indefinido", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

// ---------------------------------------------------------------------------
// Escape
// ---------------------------------------------------------------------------

test("valor com ; fica entre aspas, senão viraria duas colunas", () => {
  assert.equal(csvCell("Cozinha; Home"), '"Cozinha; Home"');
});

test("aspas internas são duplicadas", () => {
  assert.equal(csvCell('Porta 60" branca'), '"Porta 60"" branca"');
});

test("quebra de linha no texto não vira linha nova no arquivo", () => {
  const csv = toCsv([{ nome: "linha1\nlinha2", valor: 1, data: null }], colunas);
  const corpo = csv.slice(CSV_BOM.length).split("\r\n");
  assert.equal(corpo.length, 3, "cabeçalho + 1 registro + linha final");
  assert.match(corpo[1], /^"linha1\nlinha2"/);
});

test("fórmula é neutralizada: o Excel executaria a célula ao abrir", () => {
  // nome de cliente começando com = viraria fórmula
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("+55 85 99999-0000"), "'+55 85 99999-0000");
  assert.equal(csvCell("-desconto"), "'-desconto");
  assert.equal(csvCell("@usuario"), "'@usuario");
});

test("texto comum não ganha aspas nem prefixo à toa", () => {
  assert.equal(csvCell("Produção"), "Produção");
  assert.equal(csvCell("Cozinha planejada"), "Cozinha planejada");
});

// ---------------------------------------------------------------------------
// Nome do arquivo
// ---------------------------------------------------------------------------

test("nome do arquivo é seguro e datado", () => {
  const n = csvFileName("Lançamentos financeiros", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(n, "lancamentos-financeiros-2026-09-23.csv");
});

test("nome do arquivo não deixa escapar caminho", () => {
  const n = csvFileName("../../etc/passwd", new Date("2026-09-23T12:00:00.000Z"));
  assert.equal(n.includes("/"), false);
  assert.equal(n.includes(".."), false);
  assert.match(n, /\.csv$/);
});

test("nome vazio ainda gera arquivo válido", () => {
  assert.match(csvFileName("!!!", new Date("2026-09-23T12:00:00.000Z")), /^export-2026-09-23\.csv$/);
});

test("a data do arquivo usa o dia da loja, não o do servidor", () => {
  // 23/09 às 22h em Fortaleza já é dia 24 em UTC
  const n = csvFileName("x", new Date("2026-09-24T01:00:00.000Z"));
  assert.match(n, /2026-09-23/);
});

// ---------------------------------------------------------------------------
// Uso real
// ---------------------------------------------------------------------------

test("lista vazia gera só o cabeçalho", () => {
  const csv = toCsv([] as Linha[], colunas);
  assert.equal(csv, CSV_BOM + "Nome;Valor;Data\r\n");
});
