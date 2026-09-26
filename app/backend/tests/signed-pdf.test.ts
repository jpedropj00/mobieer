/**
 * PDF assinado: carimbo em cada página do original + página de assinaturas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildSignedPdf, sha256Hex, type Signer } from "../src/lib/signed-pdf";

// PNG 1x1 válido
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const signer = (over: Partial<Signer> = {}): Signer => ({
  role: "CLIENTE",
  roleLabel: "Cliente",
  name: "Juliana Castro",
  dataUrl: PNG,
  signedAt: new Date("2026-09-20T13:05:00Z"),
  ip: "189.1.2.3",
  via: "portal do cliente",
  ...over,
});

async function twoPagePdf() {
  const d = await PDFDocument.create();
  d.addPage();
  d.addPage();
  return Buffer.from(await d.save());
}

test("PDF original: mantém as páginas e acrescenta a de assinaturas; hash é do original", async () => {
  const original = await twoPagePdf();
  const r = await buildSignedPdf({
    original,
    mimeType: "application/pdf",
    fileName: "contrato.pdf",
    title: "Contrato 402-1",
    documentId: "doc1",
    organizationName: "Mobieer",
    signers: [signer({ role: "MOBIEER", roleLabel: "Mobieer", name: "Admin", via: "sistema" }), signer()],
  });
  assert.equal(r.mergedOriginal, true);
  assert.equal(r.originalHash, sha256Hex(original));
  const out = await PDFDocument.load(r.pdf);
  assert.equal(out.getPageCount(), 3);
});

test("original que não é PDF: sai só a página de assinaturas", async () => {
  const r = await buildSignedPdf({
    original: Buffer.from("conteudo do docx"),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "termo.docx",
    title: "Termo",
    documentId: "doc2",
    organizationName: null,
    signers: [signer()],
  });
  assert.equal(r.mergedOriginal, false);
  assert.equal((await PDFDocument.load(r.pdf)).getPageCount(), 1);
});

test("texto fora da fonte padrão e imagem inválida não derrubam a geração; muitos assinantes quebram página", async () => {
  const signers = Array.from({ length: 8 }, (_, i) => signer({ role: `R${i}`, name: `Pessoa ${i} 😀 ✓`, dataUrl: i === 3 ? "data:image/png;base64,AAAA" : PNG }));
  const r = await buildSignedPdf({
    original: await twoPagePdf(),
    mimeType: "application/pdf",
    fileName: "x.pdf",
    title: "Título com emoji 🚀",
    documentId: "doc3",
    organizationName: null,
    signers,
  });
  assert.ok((await PDFDocument.load(r.pdf)).getPageCount() >= 4);
});

test("PDF corrompido: cai para só o certificado", async () => {
  const r = await buildSignedPdf({ original: Buffer.from("%PDF-1.4 lixo"), mimeType: "application/pdf", fileName: "q.pdf", title: "Q", documentId: "d", organizationName: null, signers: [signer()] });
  assert.equal(r.mergedOriginal, false);
  assert.equal((await PDFDocument.load(r.pdf)).getPageCount(), 1);
});
