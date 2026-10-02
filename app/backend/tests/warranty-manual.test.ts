/**
 * Manual de uso e certificado de garantia no modelo da loja, preenchido.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { FIELD_LABELS, dateParts, labelKey, matchRooms, splitPhone } from "../src/modules/aftersales/warranty-manual.rules";
import { warrantyManualPdf } from "../src/modules/aftersales/warranty-manual";

test("telefone: DDD e número para o campo (__) ____", () => {
  assert.deepEqual(splitPhone("(85) 99721-4961"), { ddd: "85", number: "99721-4961" });
  assert.deepEqual(splitPhone("+55 85 3222 1000"), { ddd: "85", number: "3222-1000" });
  assert.deepEqual(splitPhone("ramal 12"), { ddd: "", number: "ramal 12" });
  assert.equal(splitPhone(""), null);
  assert.equal(splitPhone(null), null);
});

test("data: dia, mês e ano no fuso da loja", () => {
  assert.deepEqual(dateParts(new Date("2026-07-28T01:30:00Z")), ["27", "07", "2026"]); // 22h30 do dia 27 em Fortaleza
  assert.equal(dateParts(null), null);
});

test("ambientes: marca os do modelo e manda o resto para Outros", () => {
  assert.deepEqual(matchRooms("Cozinha, Dormitório casal; Sala de jantar e Adega"), { checked: ["Cozinha", "Sala de Jantar", "Quarto"], others: "Adega" });
  assert.deepEqual(matchRooms("Escritório"), { checked: ["Escritório"], others: "" });
  assert.deepEqual(matchRooms("Cozinhas · Área de serviço · Home"), { checked: ["Cozinha", "Home Office", "Lavanderia"], others: "" });
  assert.deepEqual(matchRooms(null), { checked: [], others: "" });
});

test("rótulos do modelo são reconhecidos com acento, caixa e dois-pontos", () => {
  assert.equal(FIELD_LABELS[labelKey("Nº do Contrato:")], "contrato");
  assert.equal(FIELD_LABELS[labelKey("Endereço:")], "endereco");
  assert.equal(FIELD_LABELS[labelKey("CPF / CNPJ:")], "documento");
  assert.equal(FIELD_LABELS[labelKey("Data da vistoria final:")], "dataVistoria");
});

test("PDF: as 6 páginas fixas da loja mais certificado e declaração, mesmo sem dado opcional", async () => {
  const pdf = await warrantyManualPdf({
    client: { name: "Cliente de Exemplo com Nome Bem Comprido para Caber na Linha do Certificado de Garantia", document: null, phone: null, email: null, address: null, city: null, zipCode: null },
    project: { code: "000-1" },
    designer: null,
    consultant: null,
    installers: null,
    purchaseDate: null,
    deliveryDate: null,
    inspectionDate: new Date("2026-07-27T15:00:00Z"),
    ambientes: "Cozinha, Quarto, Adega 你好",
    issuedAt: new Date("2026-07-27T15:00:00Z"),
  });
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 8);
  const sizes = new Set(doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`));
  assert.equal(sizes.size, 1); // páginas preenchidas no mesmo tamanho das da loja
});
