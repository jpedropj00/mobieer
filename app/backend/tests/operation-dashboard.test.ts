/**
 * Painel da operação: período no fuso da loja, baldes do gráfico e chapas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { bucketKeys, isSheetProduct, localDay, periodRange, series, sheetsFor } from "../src/modules/dashboard/operation.rules";

const now = new Date("2026-09-27T02:30:00Z"); // 26/09 23:30 em Fortaleza

test("o dia é o da loja, não o UTC", () => {
  assert.equal(localDay(now), "2026-09-26");
  const r = periodRange("today", now);
  assert.equal(r.start.toISOString(), "2026-09-26T03:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-09-27T03:00:00.000Z");
});

test("mês atual, 7 dias e ano", () => {
  assert.equal(periodRange("month", now).start.toISOString(), "2026-09-01T03:00:00.000Z");
  assert.equal(periodRange("7d", now).start.toISOString(), "2026-09-20T03:00:00.000Z");
  const y = periodRange("year", now);
  assert.equal(y.bucket, "month");
  assert.deepEqual(bucketKeys(y.start, y.end, "month"), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
});

test("baldes diários sem buraco e soma por dia (dia da loja)", () => {
  const r = periodRange("7d", now);
  const keys = bucketKeys(r.start, r.end, "day");
  assert.equal(keys.length, 7);
  assert.equal(keys[6], "2026-09-26");
  const s = series(keys, [{ at: new Date("2026-09-27T01:00:00Z"), value: 1000 }, { at: new Date("2026-09-26T12:00:00Z"), value: 500.5 }], "day");
  assert.equal(s[6].value, 1500.5); // 22h de 26/09 em Fortaleza conta no dia 26
  assert.equal(s[0].value, 0);
});

test("chapas: área das peças + 10% de perda, arredondado para cima", () => {
  assert.equal(sheetsFor(0), 0);
  assert.equal(sheetsFor(5.06), 2); // 5,57 m² com perda > 1 chapa
  assert.equal(sheetsFor(4.5), 1);
  assert.equal(sheetsFor(46), 10);
});

test("produto que é chapa, pelo nome", () => {
  assert.equal(isSheetProduct("Chapa compensado 15mm"), true);
  assert.equal(isSheetProduct("MDF Branco TX 18mm"), true);
  assert.equal(isSheetProduct("Parafuso chipboard"), false);
});
