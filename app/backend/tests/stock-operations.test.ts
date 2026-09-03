import assert from "node:assert/strict";
import test from "node:test";
import { occurrenceSchema, reservationSchema, transferSchema } from "../src/modules/stock-operations/stock-operations.schema";
import { productCodeSchema } from "../src/modules/products/products.schema";

test("aceita transferência válida entre almoxarifados", () => {
  const parsed = transferSchema.parse({ productId: "p1", quantity: 2, originWarehouseId: "w1", destinationWarehouseId: "w2", reason: "Reposição interna" });
  assert.equal(parsed.quantity, 2);
});

test("rejeita reserva e ocorrência com quantidade não positiva", () => {
  assert.equal(reservationSchema.safeParse({ productId: "p1", quantity: 0 }).success, false);
  assert.equal(occurrenceSchema.safeParse({ type: "LOSS", productId: "p1", quantity: -1, reason: "Material perdido" }).success, false);
});

test("scanner aceita códigos de barras e conteúdos QR longos", () => {
  assert.equal(productCodeSchema.parse({ code: "7891234567890" }).code, "7891234567890");
  assert.equal(productCodeSchema.parse({ code: "gestium://produto/MAT-00001?lote=ABC" }).code.includes("gestium://"), true);
});
