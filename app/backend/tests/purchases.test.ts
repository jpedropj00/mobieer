/**
 * §30 — Compras: transições da solicitação e do pedido, conferência do
 * recebimento, comparação de cotações e sugestão de reposição.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  aceitaCotacao,
  aceitaRecebimento,
  compararCotacoes,
  conferirRecebimento,
  nextOrderStatus,
  nextRequestStatus,
  quantidadeReposicao,
  statusAposRecebimento,
  totalPedido,
} from "../src/modules/purchases/purchases.rules";

test("solicitação: só aprova ou recusa o que está aguardando", () => {
  assert.deepEqual(nextRequestStatus("REQUESTED", "APPROVE"), { ok: true, status: "APPROVED" });
  assert.deepEqual(nextRequestStatus("REQUESTED", "REJECT"), { ok: true, status: "REJECTED" });
  assert.equal(nextRequestStatus("APPROVED", "APPROVE").ok, false);
  assert.equal(nextRequestStatus("REJECTED", "APPROVE").ok, false);
  assert.equal(nextRequestStatus("ORDERED", "REJECT").ok, false);
});

test("solicitação: vira pedido só depois de aprovada, e aceita mais de um pedido", () => {
  assert.equal(nextRequestStatus("REQUESTED", "ORDER").ok, false);
  assert.deepEqual(nextRequestStatus("APPROVED", "ORDER"), { ok: true, status: "ORDERED" });
  assert.deepEqual(nextRequestStatus("ORDERED", "ORDER"), { ok: true, status: "ORDERED" });
});

test("solicitação: cancelamento não desfaz pedido já emitido", () => {
  assert.equal(nextRequestStatus("REQUESTED", "CANCEL").ok, true);
  assert.equal(nextRequestStatus("APPROVED", "CANCEL").ok, true);
  assert.equal(nextRequestStatus("ORDERED", "CANCEL").ok, false);
  assert.equal(nextRequestStatus("CANCELLED", "CANCEL").ok, false);
});

test("cotação só entra em solicitação aprovada", () => {
  assert.equal(aceitaCotacao("REQUESTED"), false);
  assert.equal(aceitaCotacao("APPROVED"), true);
  assert.equal(aceitaCotacao("ORDERED"), true);
  assert.equal(aceitaCotacao("REJECTED"), false);
});

test("pedido: envia só rascunho; cancela antes de receber", () => {
  assert.deepEqual(nextOrderStatus("DRAFT", "SEND", false), { ok: true, status: "SENT" });
  assert.equal(nextOrderStatus("SENT", "SEND", false).ok, false);
  assert.equal(nextOrderStatus("SENT", "CANCEL", false).ok, true);
  const r = nextOrderStatus("PARTIALLY_RECEIVED", "CANCEL", true);
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /já recebido/);
  assert.equal(nextOrderStatus("RECEIVED", "CANCEL", false).ok, false);
});

test("pedido: recebimento só depois de enviado", () => {
  assert.equal(aceitaRecebimento("DRAFT"), false);
  assert.equal(aceitaRecebimento("SENT"), true);
  assert.equal(aceitaRecebimento("PARTIALLY_RECEIVED"), true);
  assert.equal(aceitaRecebimento("RECEIVED"), false);
  assert.equal(aceitaRecebimento("CANCELLED"), false);
});

test("status após recebimento: parcial até completar todos os itens", () => {
  assert.equal(statusAposRecebimento([{ quantity: 10, receivedQty: 0 }]), "SENT");
  assert.equal(statusAposRecebimento([{ quantity: 10, receivedQty: 4 }, { quantity: 2, receivedQty: 2 }]), "PARTIALLY_RECEIVED");
  assert.equal(statusAposRecebimento([{ quantity: 10, receivedQty: 10 }, { quantity: 2, receivedQty: 2 }]), "RECEIVED");
});

const ITENS = [
  { id: "a", description: "MDF 18mm", quantity: 10, receivedQty: 4 },
  { id: "b", description: "Dobradiça", quantity: 50, receivedQty: 0 },
];

test("recebimento: aceita até o saldo de cada item", () => {
  assert.deepEqual(conferirRecebimento(ITENS, [{ orderItemId: "a", quantity: 6 }, { orderItemId: "b", quantity: 20 }]), { ok: true });
});

test("recebimento: acima do saldo diz o item e o saldo", () => {
  const r = conferirRecebimento(ITENS, [{ orderItemId: "a", quantity: 7 }]);
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /MDF 18mm.*saldo 6/);
});

test("recebimento: recusa item de outro pedido, repetido, zero e vazio", () => {
  assert.equal(conferirRecebimento(ITENS, [{ orderItemId: "x", quantity: 1 }]).ok, false);
  assert.equal(conferirRecebimento(ITENS, [{ orderItemId: "b", quantity: 1 }, { orderItemId: "b", quantity: 1 }]).ok, false);
  assert.equal(conferirRecebimento(ITENS, [{ orderItemId: "b", quantity: 0 }]).ok, false);
  assert.equal(conferirRecebimento(ITENS, [{ orderItemId: "b", quantity: 1.5 }]).ok, false);
  assert.equal(conferirRecebimento(ITENS, []).ok, false);
});

test("total do pedido soma itens e frete com 2 casas", () => {
  assert.equal(totalPedido([{ quantity: 3, unitPrice: 10.1 }, { quantity: 1, unitPrice: 0.2 }], 5), 35.5);
});

test("comparação: menor total só entre cotações completas", () => {
  const itens = [
    { id: "i1", description: "MDF", quantity: 10 },
    { id: "i2", description: "Fita", quantity: 2 },
  ];
  const c = compararCotacoes(itens, [
    // mais barata no total, mas não cotou a fita: não pode ganhar
    { id: "q1", supplierName: "A", freight: 0, deliveryDays: 2, prices: [{ requestItemId: "i1", unitPrice: 90 }] },
    { id: "q2", supplierName: "B", freight: 50, deliveryDays: 7, prices: [{ requestItemId: "i1", unitPrice: 100 }, { requestItemId: "i2", unitPrice: 20 }] },
    { id: "q3", supplierName: "C", freight: 0, deliveryDays: 5, prices: [{ requestItemId: "i1", unitPrice: 105 }, { requestItemId: "i2", unitPrice: 15 }] },
  ]);
  assert.deepEqual(
    c.quotes.map((q) => [q.id, q.total, q.complete]),
    [
      ["q1", 900, false],
      ["q2", 1090, true],
      ["q3", 1080, true],
    ]
  );
  assert.deepEqual(c.quotes[0].missingItems, ["Fita"]);
  assert.equal(c.cheapestCompleteQuoteId, "q3");
  assert.equal(c.fastestCompleteQuoteId, "q3");
  // melhor preço por item considera todas, inclusive a incompleta
  assert.equal(c.items[0].bestQuoteId, "q1");
  assert.equal(c.items[1].bestQuoteId, "q3");
});

test("comparação sem cotações não inventa vencedor", () => {
  const c = compararCotacoes([{ id: "i1", description: "MDF", quantity: 1 }], []);
  assert.equal(c.cheapestCompleteQuoteId, null);
  assert.equal(c.items[0].bestQuoteId, null);
});

test("reposição: completa até o ideal, desconta o que está a caminho", () => {
  assert.equal(quantidadeReposicao({ stock: 2, minStock: 5, maxStock: 20 }), 18);
  assert.equal(quantidadeReposicao({ stock: 2, minStock: 5, maxStock: 20 }, 10), 8);
  // sem ideal: dobro do mínimo
  assert.equal(quantidadeReposicao({ stock: 1, minStock: 5, maxStock: null }), 9);
  // já coberto pelo que está a caminho
  assert.equal(quantidadeReposicao({ stock: 1, minStock: 5, maxStock: null }, 50), 0);
});
