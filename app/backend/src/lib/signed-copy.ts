/**
 * Gera e guarda a cópia assinada (lib/signed-pdf) dos documentos do cliente e
 * dos documentos do montador. Roda depois que a assinatura é gravada; se
 * falhar, a assinatura continua valendo e o erro só vai para o log.
 */
import { prisma } from "../prisma";
import { buildStorageKey, storage } from "./storage";
import { buildSignedPdf, sha256Hex, type Signer } from "./signed-pdf";

const ROLE_LABEL: Record<string, string> = { MOBIEER: "Empresa", CLIENTE: "Cliente", TECNICO: "Técnico", MONTADOR: "Montador" };
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r.charAt(0) + r.slice(1).toLowerCase();
const signedName = (fileName: string) => `${fileName.replace(/\.[^.]+$/, "")}-assinado.pdf`;

async function orgName(organizationId: string) {
  const o = await prisma.organization.findUnique({ where: { id: organizationId }, select: { enterprise: { select: { tradeName: true, legalName: true } } } });
  return o ? o.enterprise.tradeName ?? o.enterprise.legalName : null;
}

/** Documento do cliente/projeto com todas as assinaturas exigidas. */
export async function generateProjectDocumentSignedCopy(documentId: string) {
  try {
    const doc = await prisma.projectDocument.findUnique({
      where: { id: documentId },
      include: { signatures: { orderBy: { signedAt: "asc" } } },
    });
    if (!doc || doc.signatureStatus !== "SIGNED" || !doc.signatures.length) return null;
    const original = await storage.getBytes(doc.storageKey);
    const signers: Signer[] = doc.signatures.map((s) => ({
      role: s.role,
      roleLabel: roleLabel(s.role),
      name: s.signerName,
      dataUrl: s.dataUrl,
      signedAt: s.signedAt,
      ip: s.ip,
      via: s.signedByClientAccountId ? "portal do cliente" : "sistema (usuário interno)",
    }));
    const { pdf } = await buildSignedPdf({
      original,
      mimeType: doc.mimeType,
      fileName: doc.fileName,
      title: doc.title,
      documentId: doc.id,
      organizationName: await orgName(doc.organizationId),
      signers,
    });
    const key = buildStorageKey(doc.projectId ? `${doc.projectId}/signed` : `clients-${doc.clientId}/signed`, signedName(doc.fileName));
    await storage.put(key, pdf, "application/pdf");
    const old = doc.signedStorageKey;
    await prisma.projectDocument.update({ where: { id: doc.id }, data: { signedStorageKey: key, signedChecksum: sha256Hex(pdf), signedFileAt: new Date() } });
    if (old && old !== key) await storage.remove(old).catch(() => undefined); // assinatura refeita: a cópia anterior sai
    return key;
  } catch (e) {
    console.error("[signed-copy] documento", documentId, e);
    return null;
  }
}

/** Documento assinado pelo montador. */
export async function generateContractorDocumentSignedCopy(documentId: string) {
  try {
    const doc = await prisma.contractorDocument.findUnique({
      where: { id: documentId },
      include: { contractor: { select: { organizationId: true, name: true } } },
    });
    if (!doc || !doc.signedAt || !doc.signatureDataUrl) return null;
    const original = await storage.getBytes(doc.storageKey);
    const { pdf } = await buildSignedPdf({
      original,
      mimeType: doc.mimeType ?? "application/octet-stream",
      fileName: doc.fileName,
      title: doc.title,
      documentId: doc.id,
      organizationName: await orgName(doc.contractor.organizationId),
      signers: [
        {
          role: "MONTADOR",
          roleLabel: "Montador",
          name: doc.signerName ?? doc.contractor.name,
          dataUrl: doc.signatureDataUrl,
          signedAt: doc.signedAt,
          ip: doc.signerIp,
          via: "área do montador",
        },
      ],
    });
    const key = buildStorageKey(`contractors-${doc.contractorId}/signed`, signedName(doc.fileName));
    await storage.put(key, pdf, "application/pdf");
    const old = doc.signedStorageKey;
    await prisma.contractorDocument.update({ where: { id: doc.id }, data: { signedStorageKey: key, signedChecksum: sha256Hex(pdf) } });
    if (old && old !== key) await storage.remove(old).catch(() => undefined);
    return key;
  } catch (e) {
    console.error("[signed-copy] documento do montador", documentId, e);
    return null;
  }
}
