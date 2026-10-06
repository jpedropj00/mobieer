/**
 * Leitura de boleto: linha digitável, código de barras e texto do PDF.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { BoletoError, amountFromText, beneficiaryFromText, dueDateFromFactor, dueDateFromText, findBoletoInText, parseBoleto } from "../src/modules/finance/boleto.rules";

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
