/**
 * Termo de entrega: textos, datas e o PDF de duas páginas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { attentionText, authorizationIntro, brDay, formatDocument, longDate, roomsFromQuote } from "../src/modules/production/delivery-term.rules";
import { deliveryTermPdf } from "../src/modules/production/delivery-term.pdf";

test("termo de entrega: datas e documento no formato do modelo", () => {
  assert.equal(brDay("2026-08-05"), "05/08/2026");
  assert.equal(brDay(null), "____/____/______");
  assert.equal(longDate("Fortaleza", "2026-08-05"), "Fortaleza, 5 de agosto de 2026.");
  assert.equal(longDate("", "x"), "Fortaleza, ____ de ____________ de ______.");
  assert.equal(formatDocument("12345678901"), "123.456.789-01");
  assert.equal(formatDocument("12345678000199"), "12.345.678/0001-99");
  assert.equal(formatDocument(null), "");
});

test("termo de entrega: textos citam o contrato e o prazo informados", () => {
  assert.match(authorizationIntro("364-1"), /contrato N° 364-1\.$/);
  assert.match(authorizationIntro(" "), /N° __________/);
  assert.match(attentionText(60), /são 60 dias úteis/);
});

test("termo de entrega: ambientes do orçamento entram sem repetir", () => {
  assert.deepEqual(roomsFromQuote([{ room: "Sala" }, { room: " sala " }, { room: null }, { room: "Closet  master" }], "2026-08-05"), [
    { date: "2026-08-05", room: "SALA" },
    { date: "2026-08-05", room: "CLOSET MASTER" },
  ]);
});

test("termo de entrega: o PDF tem a folha de preparação e a de autorização", async () => {
  const pdf = await deliveryTermPdf({
    contractNumber: "364-1",
    rooms: [{ date: "2026-08-05", room: "Sala" }, { date: "2026-08-05", room: "Cozinha" }],
    deadlines: [{ label: "Prazo de entrega do material", date: null }],
    deliveryDays: 45,
    city: "Fortaleza",
    date: "2026-08-05",
    client: { name: "Cliente de Exemplo", document: null },
  });
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 2);
});
