import { prisma } from "./src/prisma";
import { buildStorageKey, storage } from "./src/lib/storage";
import { contractPdf } from "./src/modules/templates/contract.service";
(async () => {
  const p = await prisma.project.findFirstOrThrow({ where: { code: "402-1" }, select: { id: true, clientId: true, organizationId: true } });
  const pdf = await contractPdf({ title: "Contrato de teste", body: "CLÁUSULA PRIMEIRA — DO OBJETO\n\nTexto do contrato de teste para conferir o carimbo e a página de assinaturas.\n\nCLÁUSULA SEGUNDA\n\nMais texto." });
  const key = buildStorageKey(`${p.id}/teste`, "contrato-teste.pdf");
  await storage.put(key, pdf, "application/pdf");
  const d = await prisma.projectDocument.create({ data: { organizationId: p.organizationId, clientId: p.clientId, projectId: p.id, type: "CONTRATO", title: "TESTE-CLAUDE contrato", storageKey: key, fileName: "contrato-teste.pdf", mimeType: "application/pdf", sizeBytes: pdf.length, requiresSignature: true, signerRoles: ["MOBIEER", "CLIENTE"], signatureStatus: "PENDING" } });
  console.log(d.id);
  await prisma.$disconnect();
})();
