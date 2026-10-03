// Copia só as páginas fixas do manual (capa, boas-vindas, cuidados, garantia,
// assistência e contracapa). As páginas do certificado e da declaração do PDF
// original estão preenchidas à mão com dados de uma cliente: não entram.
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");

(async () => {
  const src = await PDFDocument.load(fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "CERTIFICADO GARANTIA .pdf")));
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, [0, 1, 2, 3, 4, 7])) out.addPage(p);
  fs.writeFileSync(path.join(__dirname, "..", "assets", "garantia", "manual-base.pdf"), await out.save());
  console.log("manual-base.pdf:", out.getPageCount(), "páginas");
})();
