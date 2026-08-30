import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storage, buildStorageKey } from "../../lib/storage";

const router = Router();
router.use(authenticate);

const DOC_TYPES = [
  "MANUAL_GARANTIA",
  "VISTORIA_CHECKLIST",
  "CRONOGRAMA",
  "VISTORIA_FOTOGRAFICA",
  "CONTRATO",
  "PROJETO_3D",
  "OUTRO",
] as const;

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "true" || v === "1")
  .optional();

const createSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(DOC_TYPES).default("OUTRO"),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional().nullable(),
  visibleToClient: bool,
  replacesId: z.string().min(1).optional().nullable(),
});

const updateSchema = z.object({
  type: z.enum(DOC_TYPES).optional(),
  title: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  visibleToClient: z.boolean().optional(),
});

async function ensureProject(id: string, organizationId: string) {
  const project = await prisma.project.findFirst({ where: { id, organizationId } });
  if (!project) throw new BadRequestError("Projeto inválido");
  return project;
}

async function ensureDocument(id: string, organizationId: string) {
  const doc = await prisma.projectDocument.findFirst({ where: { id, organizationId } });
  if (!doc) throw new NotFoundError("Documento não encontrado");
  return doc;
}

type SigRow = { id: string; role: string; signerName: string; signedAt: Date; dataUrl?: string };
const serialize = (d: {
  id: string;
  type: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibleToClient: boolean;
  requiresSignature: boolean;
  signerRoles: string[];
  signatureStatus: string;
  templateId: string | null;
  projectId: string | null;
  version: number;
  replacesId: string | null;
  createdAt: Date;
  uploadedBy?: { id: string; name: string } | null;
  signatures?: SigRow[];
}) => ({
  id: d.id,
  type: d.type,
  title: d.title,
  description: d.description,
  fileName: d.fileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  visibleToClient: d.visibleToClient,
  requiresSignature: d.requiresSignature,
  signerRoles: d.signerRoles,
  signatureStatus: d.signatureStatus,
  templateId: d.templateId,
  projectId: d.projectId,
  version: d.version,
  replacesId: d.replacesId,
  createdAt: d.createdAt,
  uploadedBy: d.uploadedBy ?? null,
  signatures: (d.signatures ?? []).map((s) => ({ id: s.id, role: s.role, signerName: s.signerName, signedAt: s.signedAt })),
  downloadUrl: `/api/documents/${d.id}/download`,
});

/** Recalcula PENDING/SIGNED conforme as assinaturas cobrem os papéis exigidos. */
async function recomputeSignatureStatus(documentId: string) {
  const doc = await prisma.projectDocument.findUnique({
    where: { id: documentId },
    select: { requiresSignature: true, signerRoles: true, signatures: { select: { role: true } } },
  });
  if (!doc) return;
  if (!doc.requiresSignature) {
    await prisma.projectDocument.update({ where: { id: documentId }, data: { signatureStatus: "NOT_REQUIRED" } });
    return;
  }
  const signed = new Set(doc.signatures.map((s) => s.role));
  const need = doc.signerRoles.length ? doc.signerRoles : ["MOBIEER", "CLIENTE"];
  const done = need.every((r) => signed.has(r));
  await prisma.projectDocument.update({
    where: { id: documentId },
    data: { signatureStatus: done ? "SIGNED" : "PENDING" },
  });
}

export { recomputeSignatureStatus };

// GET /api/documents?projectId=xxx  |  ?clientId=xxx
router.get(
  "/",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const projectId = String(req.query.projectId ?? "").trim();
    const clientId = String(req.query.clientId ?? "").trim();
    if (!projectId && !clientId) throw new BadRequestError("Informe projectId ou clientId");
    if (projectId) await ensureProject(projectId, req.user!.organizationId);
    const docs = await prisma.projectDocument.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(projectId ? { projectId } : {}),
        ...(clientId ? { clientId } : {}),
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        signatures: { select: { id: true, role: true, signerName: true, signedAt: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    return ok(res, docs.map(serialize));
  })
);

// GET /api/documents/:id/signatures
router.get(
  "/:id/signatures",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const doc = await ensureDocument(req.params.id, req.user!.organizationId);
    const sigs = await prisma.documentSignature.findMany({ where: { documentId: doc.id }, orderBy: { signedAt: "asc" } });
    return ok(res, sigs);
  })
);

// POST /api/documents/:id/signatures  { role, signerName, dataUrl }
router.post(
  "/:id/signatures",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const doc = await ensureDocument(req.params.id, req.user!.organizationId);
    if (!doc.requiresSignature) throw new BadRequestError("Este documento não exige assinatura");
    const input = z
      .object({
        role: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
        signerName: z.string().trim().min(2).max(160),
        dataUrl: z.string().startsWith("data:image/").max(2_000_000),
      })
      .parse(req.body);
    const roles = doc.signerRoles.length ? doc.signerRoles : ["MOBIEER", "CLIENTE"];
    if (!roles.includes(input.role)) throw new BadRequestError(`Papel inválido. Esperados: ${roles.join(", ")}`);

    await prisma.documentSignature.upsert({
      where: { documentId_role: { documentId: doc.id, role: input.role } },
      create: {
        documentId: doc.id,
        role: input.role,
        signerName: input.signerName,
        dataUrl: input.dataUrl,
        signedByUserId: req.user!.id,
        ip: req.ip ?? null,
      },
      update: { signerName: input.signerName, dataUrl: input.dataUrl, signedByUserId: req.user!.id, signedAt: new Date() },
    });
    await recomputeSignatureStatus(doc.id);
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DOCUMENT_SIGNED", entity: "ProjectDocument", entityId: doc.id, details: { role: input.role } },
    });
    const updated = await prisma.projectDocument.findUnique({ where: { id: doc.id }, select: { signatureStatus: true } });
    return ok(res, { signatureStatus: updated?.signatureStatus }, "Assinatura registrada");
  })
);

// POST /api/documents  (multipart/form-data: file + campos)
router.post(
  "/",
  requirePermission("documents.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    const input = createSchema.parse(req.body);
    const project = await ensureProject(input.projectId, req.user!.organizationId);

    let version = 1;
    if (input.replacesId) {
      const previous = await ensureDocument(input.replacesId, req.user!.organizationId);
      version = previous.version + 1;
    }

    const key = buildStorageKey(project.id, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    const checksum = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

    const doc = await prisma.projectDocument.create({
      data: {
        organizationId: req.user!.organizationId,
        projectId: project.id,
        clientId: project.clientId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        storageKey: key,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        checksum,
        visibleToClient: input.visibleToClient ?? false,
        version,
        replacesId: input.replacesId ?? null,
        uploadedById: req.user!.id,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: "PROJECT_DOCUMENT_UPLOADED",
        entity: "ProjectDocument",
        entityId: doc.id,
        details: { projectId: project.id, type: doc.type, fileName: doc.fileName },
      },
    });

    return ok(res, serialize(doc), "Documento enviado");
  })
);

// PATCH /api/documents/:id
router.patch(
  "/:id",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    await ensureDocument(req.params.id, req.user!.organizationId);
    const input = updateSchema.parse(req.body);
    const doc = await prisma.projectDocument.update({
      where: { id: req.params.id },
      data: { ...input, description: input.description ?? undefined },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: "PROJECT_DOCUMENT_UPDATED",
        entity: "ProjectDocument",
        entityId: doc.id,
        details: input,
      },
    });
    return ok(res, serialize(doc), "Documento atualizado");
  })
);

// GET /api/documents/:id/download
router.get(
  "/:id/download",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const doc = await ensureDocument(req.params.id, req.user!.organizationId);
    const signed = await storage.getSignedUrl(doc.storageKey, doc.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    stream.pipe(res);
  })
);

// DELETE /api/documents/:id
router.delete(
  "/:id",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const doc = await ensureDocument(req.params.id, req.user!.organizationId);
    await storage.remove(doc.storageKey).catch(() => undefined);
    await prisma.projectDocument.delete({ where: { id: doc.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: "PROJECT_DOCUMENT_DELETED",
        entity: "ProjectDocument",
        entityId: doc.id,
        details: { fileName: doc.fileName },
      },
    });
    return ok(res, { id: doc.id }, "Documento removido");
  })
);

export default router;
