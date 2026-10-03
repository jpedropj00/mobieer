/**
 * Pasta técnica: títulos das pranchas, encaixe do desenho, especificação por
 * ambiente e o índice de folhas. Referência: "PROJETO EXECUTIVO VARANDA".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fitRect, sheetIndex, sheetsByRoom, specBlocks, titleFromFile, type TechSheet } from "../src/modules/techproject/tech-folder.rules";

const sheet = (id: string, room: string, title: string): TechSheet => ({ id, room, title, scale: null, note: null, storageKey: `k/${id}`, fileName: `${id}.png`, mime: "image/png", page: null, stamp: true });

test("título sugerido pelo nome do arquivo", () => {
  assert.equal(titleFromFile("planta baixa.png", 0), "PLANTA BAIXA");
  assert.equal(titleFromFile("VARANDA_vista-a-interna.jpg", 2), "VISTA A INTERNA");
  assert.equal(titleFromFile("vista_a.png", 1), "VISTA A");
  assert.equal(titleFromFile("perspectiva 3d.png", 3), "PERSPECTIVA");
  assert.equal(titleFromFile("render final.jpeg", 3), "PERSPECTIVA");
  assert.equal(titleFromFile("IMG_2041.png", 4), "PRANCHA 5");
});

test("o desenho encaixa na área sem distorcer e fica centralizado", () => {
  const box = { x: 20, y: 120, w: 800, h: 400 };
  assert.deepEqual(fitRect(1600, 400, box), { x: 20, y: 220, w: 800, h: 200 }); // largo: limita na largura
  assert.deepEqual(fitRect(400, 800, box), { x: 320, y: 120, w: 200, h: 400 }); // alto: limita na altura
});

test("especificação por ambiente vem do orçamento; ambiente sem dado fica de fora", () => {
  const blocks = specBlocks([
    { room: "Varanda", description: "Armário inferior e prateleiras", corpo: "MDF Branco TX", porta: "Provençal MDF Areia", puxador: "Creta dourado" },
    { room: "varanda", description: "Aéreo", corpo: "MDF Naval", complemento: "Prateleira Carvalho Treviso" },
    { room: "Cozinha", description: "" },
    { room: null, description: "Home office", modelo: "Ripado" },
  ]);
  assert.deepEqual(blocks, [
    {
      room: "Varanda",
      description: "Armário inferior e prateleiras",
      rows: [
        { label: "Caixaria", value: "MDF Branco TX" }, // a primeira informação de cada campo vale
        { label: "Portas e frentes", value: "Provençal MDF Areia" },
        { label: "Puxador", value: "Creta dourado" },
        { label: "Complemento", value: "Prateleira Carvalho Treviso" },
      ],
    },
    { room: "Home office", description: null, rows: [{ label: "Modelo", value: "Ripado" }] },
  ]);
});

test("pranchas agrupadas por ambiente e índice contando capa e especificação", () => {
  const sheets = [sheet("1", "Varanda", "PLANTA BAIXA"), sheet("2", "Cozinha", "PLANTA BAIXA"), sheet("3", "varanda", "VISTA A")];
  assert.deepEqual(sheetsByRoom(sheets).map((g) => [g.room, g.sheets.map((s) => s.id)]), [["Varanda", ["1", "3"]], ["Cozinha", ["2"]]]);
  assert.deepEqual(sheetIndex(sheets, 1), [
    { n: 3, room: "Varanda", title: "PLANTA BAIXA" },
    { n: 4, room: "varanda", title: "VISTA A" },
    { n: 5, room: "Cozinha", title: "PLANTA BAIXA" },
  ]);
  assert.equal(sheetIndex(sheets, 0)[0].n, 2); // sem especificação, a primeira prancha é a folha 2
});
