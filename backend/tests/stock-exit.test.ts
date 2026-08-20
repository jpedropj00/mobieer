import assert from "node:assert/strict";
import test from "node:test";
import { createExitWithClient } from "../src/modules/stock/stock.service";

test("recusa a saída quando a atualização condicional não encontra saldo", async () => {
  let movementCreated = false;
  const tx = {
    product: {
      findUnique: async (args: { select?: unknown }) => args.select ? { stock: 0 } : { id: "p1", name: "Produto", stock: 1, reservedStock: 0, warehouseId: null },
    },
    $executeRaw: async () => 0,
    stockMovement: { create: async () => { movementCreated = true; return { id: "m1" }; } },
  };

  await assert.rejects(
    createExitWithClient(tx as never, { items: [{ productId: "p1", quantity: 1 }] }, "u1", "Usuário"),
    /Estoque disponível insuficiente/
  );
  assert.equal(movementCreated, false);
});
