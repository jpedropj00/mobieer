/**
 * Leitura de boleto: linha digitável, código de barras e texto do PDF.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BoletoError, amountFromText, beneficiaryFromText, dueDateFromFactor, dueDateFromText, findBoletoInText, invoiceItemsFromText, invoiceTotalsByStore, parseBoleto } from "../src/modules/finance/boleto.rules";

const now = new Date("2026-08-20T12:00:00Z");
// boleto Santander da foto enviada: R$ 123,70, vence 26/08/2026
const LINE = "03399.10317 78302.604232 34500.801013 5 15500000012370";

test("linha digitável do boleto bancário: valor, vencimento (fator novo) e banco", () => {
  const b = parseBoleto(LINE, now);
  assert.equal(b.kind, "BANCARIO");
  assert.equal(b.amount, 123.7);
  assert.equal(b.dueDate, "2026-08-26");
  assert.equal(b.bankCode, "033");
  assert.equal(b.barcode.length, 44);
  assert.equal(b.line, LINE);
});

test("código de barras (44) dá o mesmo boleto e remonta a linha digitável", () => {
  const fromLine = parseBoleto(LINE, now);
  const fromBarcode = parseBoleto(fromLine.barcode, now);
  assert.deepEqual(fromBarcode, fromLine);
});

test("número digitado errado é recusado pelo dígito verificador", () => {
  assert.throws(() => parseBoleto(LINE.replace("10317", "10318"), now), BoletoError);
  assert.throws(() => parseBoleto("123", now), /47 ou 48/);
});

test("fator de vencimento: contagem antiga e a nova (a partir de 22/02/2025)", () => {
  assert.equal(dueDateFromFactor(1000, new Date("2000-07-01T00:00:00Z")), "2000-07-03");
  assert.equal(dueDateFromFactor(1000, new Date("2025-03-01T00:00:00Z")), "2025-02-22");
  assert.equal(dueDateFromFactor(9999, new Date("2025-02-20T00:00:00Z")), "2025-02-21");
  assert.equal(dueDateFromFactor(0), null);
});

test("arrecadação (conta de luz, água): valor do código, sem vencimento", () => {
  // código de barras montado com DV válido: segmento 2 (saneamento), valor R$ 85,40
  const body = "826" + "00000008540" + "0123" + "4567890123456789012345678";
  // acha o DV geral (mod 10, referência 6) por tentativa
  const bc = [...Array(10).keys()].map((dv) => body.slice(0, 3) + dv + body.slice(3)).find((c) => {
    try { parseBoleto(c); return true; } catch { return false; }
  })!;
  const b = parseBoleto(bc);
  assert.equal(b.kind, "ARRECADACAO");
  assert.equal(b.amount, 85.4);
  assert.equal(b.dueDate, null);
  // a linha de 48 dígitos volta ao mesmo código
  assert.equal(parseBoleto(b.line).barcode, bc);
});

test("PDF: acha a linha digitável no meio do texto e o beneficiário", () => {
  const text = `Santander 033-7\n${LINE}\nBeneficiário\nBANCO SANTANDER S/A – 090400888000142\nVencimento 26/08/2026`;
  assert.equal(findBoletoInText(text, now)?.amount, 123.7);
  assert.equal(findBoletoInText("sem boleto aqui 123", now), null);
  assert.deepEqual(beneficiaryFromText(text), { name: "BANCO SANTANDER S/A", document: "090400888000142" });
});

// fatura de cartão: o código vem com valor e vencimento zerados, os dois saem do texto
const FATURA = [
  "Pagamento Total Data de Vencimento Limite Total",
  "2.506,63 13/10/2026 3.200,00",
  "encargos que terão o valor máximo de R$453,32.",
  "Beneficiário: Financeira Exemplo S.A. Nosso Número: 1234567890-1 Vencimento : 13/10/2026",
  "Pagador: FULANA DE TAL Nº do Documento: 1234567890 Valor : 2.506,63",
  "Beneficiário CNPJ Agência / Código Beneficiário",
  "11.222.333/0001-81",
  "Valor original da dívida R$ 0,00",
].join("\n");

test("fatura de cartão: valor e vencimento lidos do texto do PDF", () => {
  assert.equal(amountFromText(FATURA), 2506.63);
  assert.equal(dueDateFromText(FATURA), "2026-10-13");
  assert.equal(amountFromText("Valor original da dívida R$ 0,00"), null);
  assert.equal(dueDateFromText("sem data aqui"), null);
});

test("beneficiário da fatura: nome sem o 'Nosso Número' e CNPJ achado no resto do texto", () => {
  assert.deepEqual(beneficiaryFromText(FATURA), { name: "Financeira Exemplo S.A.", document: "11.222.333/0001-81" });
});

test("fatura de cartão: compras do período, loja por loja", () => {
  const texto = [
    "Lançamentos detalhados do período:",
    "Data Descrição Estabelecimento Crédito/",
    "09/09/2026 Pagamento Fatura Pix -2.978,65",
    "13/03/2026 Parcela de compra lojista Visa - Parc.7/8 LOJA A 77,32",
    "09/09/2026 Compra a Vista sem Juros Visa FORNECEDOR B 1.993,79",
    "10/09/2026 Compra a Vista sem Juros Visa DL           APP C 16,15",
    "11/09/2026 Compra a Vista sem Juros Visa DL APP C 3,85",
    "28/09/2026 ANUIDADE Int - Parc.9/12 23,90",
    "Compras parceladas - Próximas Faturas",
    "13/03/2026 LOJA A Parc. 8/8 77,32",
  ].join("\n");
  const itens = invoiceItemsFromText(texto);
  assert.equal(itens.length, 5); // sem o pagamento da fatura anterior e sem as próximas faturas
  assert.deepEqual(itens[0], { date: "2026-03-13", store: "LOJA A", description: "Parcela de compra lojista Visa - Parc.7/8 LOJA A", installment: "7/8", amount: 77.32 });
  assert.equal(itens[1].store, "FORNECEDOR B");
  assert.equal(itens[1].amount, 1993.79);
  assert.equal(itens[4].store, "ANUIDADE Int");
  assert.deepEqual(invoiceTotalsByStore(itens)[0], { store: "FORNECEDOR B", count: 1, total: 1993.79 });
  assert.deepEqual(invoiceTotalsByStore(itens).find((t) => t.store === "APP C"), { store: "APP C", count: 2, total: 20 });
  assert.deepEqual(invoiceItemsFromText("03399.10317 78302.604232 34500.801013 5 15500000012370"), []);
});
