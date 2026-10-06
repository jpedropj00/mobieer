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
  // o vão interno (2260) menos 5 prateleiras de 15,5 mm, dividido em 6 vãos livres
  assert.equal(l.thickness, 15.5);
  assert.equal(l.chain[1].value, 363.8);
  // a espessura da prateleira também é cotada: vão, 15,5, vão, 15,5…
  assert.equal(l.chain[2].value, 15.5);
  assert.equal(l.chain.length, 1 + 6 + 5 + 1);
  assert.ok(Math.abs(l.chain.at(-2)!.y1 - 2330) < 0.01); // o último vão fecha embaixo do roda-teto
  assert.deepEqual(l.callout, ["ARMÁRIO COM CAIXARIA EM", "MDF CINZA URBAN", "L 1360 X A 2380 X P 550"]);
  assert.deepEqual(l.warnings, []);
});

test("vista cotada: alturas digitadas saem como estão; a última pode ficar com o resto", () => {
  const col = (heights: number[]) => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: null, count: 2, heights }] });
  // 2260 de vão interno menos 2 prateleiras de 15,5 = 2229 de vãos livres
  const completa = col([1000, 729, 500]);
  assert.deepEqual(completa.columns[0].bands.map((b) => b.value), [500, 729, 1000]); // de baixo para cima
  assert.deepEqual(completa.warnings, []);
  const resto = col([1000, 729]);
  assert.equal(resto.columns[0].bands[0].value, 500);
  // não fecha com o vão: desenha mesmo assim, avisa e mantém a cota digitada
  const sobra = col([1000, 760, 520]);
  assert.equal(sobra.warnings.length, 1);
  assert.match(sobra.warnings[0], /somam 2280 mm e cabem 2229 mm \(vão interno de 2260 mm menos 2 prateleiras de 15,5 mm\) — diferença de 51 mm/);
  assert.equal(sobra.columns[0].bands[0].value, 520);
  assert.ok(Math.abs(sobra.columns[0].bands.at(-1)!.y1 - 2330) < 0.01); // o desenho fecha no topo
});

test("vista cotada: medidas que não fecham são recusadas com explicação", () => {
  assert.throws(() => layoutDrawing({ ...armario, width: 0 }), DrawingError);
  assert.throws(() => layoutDrawing({ ...armario, top: 2000, base: 500 }), /roda-teto e o rodapé/);
  assert.throws(() => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: 900 }, { ...armario.columns[1], width: 900 }] }), /mais que a largura/);
  assert.throws(() => layoutDrawing({ ...armario, columns: [{ ...armario.columns[0], width: 600 }, { ...armario.columns[1], width: 600 }] }), /deixe uma coluna sem largura/);
  assert.throws(() => layoutDrawing({ ...armario, sideLeft: 800, sideRight: 800 }), /fechamentos laterais/);
});

test("vista cotada: fechamento lateral tira largura das colunas e a espessura pode ser trocada", () => {
  const l = layoutDrawing({ ...armario, sideLeft: 50, sideRight: 30, thickness: 18, columns: [{ ...armario.columns[0], width: null }] });
  assert.equal(l.sideLeft, 50);
  assert.equal(l.columns[0].x, 50); // a coluna começa depois do fechamento
  assert.equal(l.columns[0].width, 1280); // 1360 - 50 - 30
  assert.equal(l.chain[2].value, 18);
  // gaveta não tem chapa entre as frentes: nada de espessura na cadeia
  const g = layoutDrawing({ ...armario, columns: [{ kind: "GAVETAS", width: null, count: 4, heights: [], label: null }] });
  assert.deepEqual(g.chain.map((c) => c.value), [70, 565, 565, 565, 565, 50]);
});

test("vista cotada: o PDF sai com uma página só", async () => {
  const { pdf, warnings } = await drawingPdf(armario);
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  assert.deepEqual(warnings, []);
});

test("vista cotada: prateleira atrás das portas fica guardada, mas não aparece por fora", () => {
  const baixo: DrawingSpec = { description: "Armário baixo com portas", width: 900, height: 750, depth: 450, top: 0, base: 50, thickness: 15, specs: ["Puxador fornecido pelo cliente"], columns: [{ kind: "PORTAS", width: null, count: 2, shelves: 1, heights: [], label: null }] };
  const l = layoutDrawing(baixo);
  assert.equal(l.columns[0].hidden, true);
  assert.equal(l.columns[0].lines.length, 1);
  // 700 de vão interno menos a prateleira de 15 mm
  assert.deepEqual(l.columns[0].bands.map((b) => b.value), [342.5, 342.5]);
});

test("vista com imagem 3D ao lado e chamada por coluna sai em uma página", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const png = fs.readFileSync(path.join(process.cwd(), "assets", "cronograma", "logo.png"));
  const spec: DrawingSpec = { ...armario, columns: [armario.columns[0], { ...armario.columns[1], note: "Portas de giro em alumínio prata e espelho prata L 680 x A 2349" }] };
  const sem = await drawingPdf(spec);
  const com = await drawingPdf(spec, { closed: { bytes: png, mime: "image/png" } });
  assert.equal((await PDFDocument.load(com.pdf)).getPageCount(), 1);
  assert.ok(com.pdf.length > sem.pdf.length);
  // imagem ilegível não derruba a vista
  const ruim = await drawingPdf(spec, { closed: { bytes: Buffer.from("nao e imagem"), mime: "image/png" } });
  assert.equal((await PDFDocument.load(ruim.pdf)).getPageCount(), 1);
});

test("anotações da prancha: só PNG de verdade é aceito e a anotação entra no PDF da pasta", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { pngFromDataUrl } = await import("../src/modules/techproject/tech-folder.rules");
  const { techFolderPdf } = await import("../src/modules/techproject/tech-folder.pdf");
  const png = fs.readFileSync(path.join(process.cwd(), "assets", "cronograma", "logo.png"));
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  assert.deepEqual(pngFromDataUrl(dataUrl), png);
  assert.equal(pngFromDataUrl("data:image/png;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64")), null);
  assert.equal(pngFromDataUrl("data:text/html;base64,AAAA"), null);
  assert.equal(pngFromDataUrl("https://exemplo.com/a.png"), null);

  const { pdf: vista } = await drawingPdf(armario);
  const sheet = { id: "1", room: "Suíte", title: "VISTA A", scale: "1:20", note: null, storageKey: "k", fileName: "d.pdf", mime: "application/pdf", page: 0, stamp: true, bytes: vista };
  const base = { client: "Cliente", project: { code: "P-1", name: "Suíte" }, specs: [], notes: [], issuedAt: new Date("2026-10-06T12:00:00Z") };
  const sem = await techFolderPdf({ ...base, sheets: [sheet] });
  const com = await techFolderPdf({ ...base, sheets: [{ ...sheet, overlayBytes: png }] });
  assert.equal((await PDFDocument.load(com)).getPageCount(), 2);
  assert.ok(com.length > sem.length + 1000);
  // anotação corrompida não derruba a pasta
  const ruim = await techFolderPdf({ ...base, sheets: [{ ...sheet, overlayBytes: Buffer.from("x") }] });
  assert.equal((await PDFDocument.load(ruim)).getPageCount(), 2);
});

test("vista cotada: sapateira, maleiro e 'outros' com o nome escrito", () => {
  const l = layoutDrawing({
    ...armario,
    columns: [
      { kind: "SAPATEIRA", width: 830, count: 9, heights: [], label: null },
      { kind: "MALEIRO", width: 500, count: 0, heights: [], label: null },
      { kind: "OUTROS", width: null, count: 1, heights: [], label: "cabideiro" },
    ],
  });
  assert.equal(l.columns[0].bands.length, 10);
  assert.equal(l.columns[0].bands[0].label, "SAPATEIRA");
  // maleiro sem divisão é um vão só, com o nome
  assert.deepEqual(l.columns[1].bands.map((b) => b.label), ["MALEIRO"]);
  assert.equal(l.columns[1].lines.length, 0);
  assert.deepEqual(l.columns[2].bands.map((b) => b.label), ["CABIDEIRO", "CABIDEIRO"]);
  // "outros" sem nome não fica em branco
  assert.equal(layoutDrawing({ ...armario, columns: [{ kind: "OUTROS", width: null, count: 0, heights: [], label: " " }] }).columns[0].bands[0].label, "OUTROS");
});

test("vista cotada: medidas já escritas na descrição não saem repetidas na chamada", () => {
  const l = layoutDrawing({ ...armario, description: "Armário em MDF cinza urban L 1360 x A 2380 x P 550" });
  assert.equal(l.callout.filter((x) => /L 1360/.test(x)).length, 1);
  assert.ok(layoutDrawing(armario).callout.includes("L 1360 X A 2380 X P 550"));
});
