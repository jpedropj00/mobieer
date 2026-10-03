/**
 * Etiquetas com código de barras e leitura na produção.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { checklistSummary, labelLayout, measuresText, nextCodes, normalizeScan, scanOutcome } from "../src/modules/production/labels.rules";

test("códigos: começam em 10000001 e seguem do maior já usado", () => {
  assert.deepEqual(nextCodes(null, 2), ["10000001", "10000002"]);
  assert.deepEqual(nextCodes("10000045", 3), ["10000046", "10000047", "10000048"]);
  assert.deepEqual(nextCodes("lixo", 1), ["10000001"]);
  assert.deepEqual(nextCodes("10000045", 0), []);
});

test("leitura: aproveita só os dígitos e recusa o que não é código", () => {
  assert.equal(normalizeScan(" 10000046\r\n"), "10000046");
  assert.equal(normalizeScan("]C110000046"), "110000046");
  assert.equal(normalizeScan("abc"), null);
  assert.equal(normalizeScan(""), null);
  assert.equal(normalizeScan("123"), null);
});

test("modo baixa: qualquer item em aberto fica pronto; repetir a leitura não muda nada", () => {
  const a = scanOutcome({ status: "PENDING", sector: null }, "done");
  assert.deepEqual([a.kind, a.kind === "MOVE" && a.status, a.kind === "MOVE" && a.sector], ["MOVE", "DONE", null]);
  const b = scanOutcome({ status: "IN_PROGRESS", sector: "FURACAO" }, "done");
  assert.equal(b.kind === "MOVE" && b.eventSector, "FURACAO");
  assert.equal(scanOutcome({ status: "DONE", sector: null }, "done").kind, "ALREADY");
  assert.equal(scanOutcome({ status: "CANCELLED", sector: null }, "done").kind, "ERROR");
});

test("modo setor: entra no corte, anda de setor em setor e conclui no último", () => {
  const start = scanOutcome({ status: "PENDING", sector: null }, "advance");
  assert.deepEqual([start.kind === "MOVE" && start.sector, start.kind === "MOVE" && start.event, start.message], ["CORTE", "ENTER", "Entrou em Corte"]);
  const mid = scanOutcome({ status: "IN_PROGRESS", sector: "CORTE" }, "advance");
  assert.deepEqual([mid.kind === "MOVE" && mid.sector, mid.message], ["FITA_BORDA", "Corte concluído — segue para Fita de borda"]);
  const end = scanOutcome({ status: "IN_PROGRESS", sector: "EXPEDICAO" }, "advance");
  assert.deepEqual([end.kind === "MOVE" && end.status, end.kind === "MOVE" && end.sector], ["DONE", null]);
});

test("conferência: cancelado não conta; o que falta é o que não tem baixa", () => {
  assert.deepEqual(checklistSummary([{ status: "DONE" }, { status: "PENDING" }, { status: "IN_PROGRESS" }, { status: "CANCELLED" }, { status: "DONE" }]), { total: 4, done: 2, missing: 2, percent: 50 });
  assert.deepEqual(checklistSummary([]), { total: 0, done: 0, missing: 0, percent: 0 });
});

test("medidas da peça e folha de etiquetas", () => {
  assert.equal(measuresText({ comprimento: 720, largura: 560.5, espessura: 15 }), "720 × 560,5 × 15 mm");
  assert.equal(measuresText({ comprimento: 720, largura: null, espessura: null }), null);
  const a4 = labelLayout("a4");
  assert.equal(a4.cells.length, 24);
  assert.equal(Math.round(a4.cells[23].x + a4.cells[23].w), Math.round(a4.page[0])); // 3 colunas fecham a largura da folha
  assert.equal(Math.round(a4.cells[23].y + a4.cells[23].h), Math.round(a4.page[1])); // 8 linhas fecham a altura
  assert.equal(labelLayout("termica").perPage, 1);
});
