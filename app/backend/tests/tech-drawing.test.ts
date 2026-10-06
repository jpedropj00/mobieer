/**
 * Desenho técnico por medidas: contas da vista cotada e o PDF de uma página.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { DrawingError, layoutDrawing, mm, parseHeights, type DrawingSpec } from "../src/modules/techproject/tech-drawing.rules";
import { drawingPdf } from "../src/modules/techproject/tech-drawing.pdf";

// o armário do vídeo: 1360 x 2380 x 550, prateleiras à esquerda e duas portas à direita
const armario: DrawingSpec = {
  description: "Armário com caixaria em MDF cinza urban",
  width: 1360,
  height: 2380,
  depth: 550,
  top: 50,
  base: 70,
  columns: [
    { kind: "PRATELEIRAS", width: 680, count: 5, heights: [], label: null },
    { kind: "PORTAS", width: null, count: 2, heights: [], label: null },
  ],
};

test("medidas: número no formato da prancha e leitura das alturas digitadas", () => {
  assert.equal(mm(2380), "2380");
  assert.equal(mm(378.5), "378,5");
  assert.deepEqual(parseHeights("378,5; 378.5 / 400\n1.200"), [378.5, 378.5, 400, 1200]);
  assert.deepEqual(parseHeights("300 300 400"), [300, 300, 400]);
  assert.deepEqual(parseHeights(""), []);
});

test("vista cotada: prateleiras dividem o vão por igual e a cadeia fecha na altura", () => {
  const l = layoutDrawing(armario);
  assert.equal(l.columns[0].bands.length, 6); // 5 prateleiras = 6 vãos
  assert.equal(l.columns[0].lines.length, 5);
  assert.equal(l.columns[1].width, 680); // ficou com o resto da largura
  assert.equal(l.columns[1].doors, 2);
  assert.equal(l.chain[0].value, 70); // rodapé
  assert.equal(l.chain.at(-1)!.value, 50); // topo
  assert.equal(l.chain.at(-1)!.y1, 2380);
  assert.equal(l.chain[1].value, 376.7); // (2380 - 50 - 70) / 6
  assert.deepEqual(l.callout, ["ARMÁRIO COM CAIXARIA EM", "MDF CINZA URBAN", "L 1360 X A 2380 X P 550"]);
  assert.deepEqual(l.warnings, []);
});

test("vista cotada: alturas digitadas saem como estão; a última pode ficar com o resto", () => {
  const col = (heights: number[]) => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: null, count: 2, heights }] });
  const completa = col([1000, 760, 500]);
  assert.deepEqual(completa.columns[0].bands.map((b) => b.value), [500, 760, 1000]); // de baixo para cima
  assert.deepEqual(completa.warnings, []);
  const resto = col([1000, 760]);
  assert.equal(resto.columns[0].bands[0].value, 500);
  // não fecha com o vão: desenha mesmo assim, avisa e mantém a cota digitada
  const sobra = col([1000, 760, 520]);
  assert.equal(sobra.warnings.length, 1);
  assert.match(sobra.warnings[0], /somam 2280 mm e o vão interno é 2260 mm/);
  assert.equal(sobra.columns[0].bands[0].value, 520);
  assert.ok(Math.abs(sobra.columns[0].bands.at(-1)!.y1 - 2330) < 0.01); // o desenho fecha no topo
});

test("vista cotada: medidas que não fecham são recusadas com explicação", () => {
  assert.throws(() => layoutDrawing({ ...armario, width: 0 }), DrawingError);
  assert.throws(() => layoutDrawing({ ...armario, top: 2000, base: 500 }), /topo e o rodapé/);
  assert.throws(() => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: 900 }, { ...armario.columns[1], width: 900 }] }), /mais que a largura/);
  assert.throws(() => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: 600 }, { ...armario.columns[1], width: 600 }] }), /deixe uma coluna sem largura/);
});

test("vista cotada: o PDF sai com uma página só", async () => {
  const { pdf, warnings } = await drawingPdf(armario);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  assert.deepEqual(warnings, []);
});
