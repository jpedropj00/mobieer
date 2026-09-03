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

const rolesFromInput = (v: unknown): string[] =>
  (typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [])
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean);

const serialize = (t: {
  id: string; name: string; type: string; description: string | null; fileName: string; mimeType: string;
  sizeBytes: number; requiresSignature: boolean; signerRoles: string[]; visibleToClient: boolean; active: boolean;
  createdAt: Date; _count?: { documents: number };
}) => ({
  id: t.id,
  name: t.name,
  type: t.type,
  description: t.description,
  fileName: t.fileName,
  mimeType: t.mimeType,
  sizeBytes: t.sizeBytes,
  requiresSignature: t.requiresSignature,
  signerRoles: t.signerRoles,
  visibleToClient: t.visibleToClient,
  active: t.active,
  createdAt: t.createdAt,
  generatedCount: t._count?.documents ?? 0,
  downloadUrl: `/api/templates/${t.id}/download`,
});

// GET /api/templates
router.get(
  "/",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.documentTemplate.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { documents: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return ok(res, rows.map(serialize));
  })
);

// POST /api/templates  (multipart: file + campos)
router.post(
  "/",
  requirePermission("documents.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Arquivo do modelo é obrigatório");
    const input = z
      .object({
        name: z.string().trim().min(2).max(200),
        type: z.enum(DOC_TYPES).default("OUTRO"),
        description: z.string().trim().max(5000).optional().nullable(),
        requiresSignature: bool,
        visibleToClient: bool,
      })
      .parse(req.body);

    const signerRoles = rolesFromInput(req.body.signerRoles);
    const key = buildStorageKey(`templates/${req.user!.organizationId}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);

    const t = await prisma.documentTemplate.create({
      data: {
        organizationId: req.user!.organizationId,
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        storageKey: key,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        requiresSignature: input.requiresSignature ?? false,
        signerRoles: (input.requiresSignature ?? false) ? (signerRoles.length ? signerRoles : ["MOBIEER", "CLIENTE"]) : [],
        visibleToClient: input.visibleToClient ?? true,
        createdById: req.user!.id,
      },
      include: { _count: { select: { documents: true } } },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DOCUMENT_TEMPLATE_CREATED", entity: "DocumentTemplate", entityId: t.id, details: { name: t.name } },
    });
    return ok(res, serialize(t), "Modelo criado");
  })
);

// PATCH /api/templates/:id
router.patch(
  "/:id",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!current) throw new NotFoundError("Modelo não encontrado");
    const input = z
      .object({
        name: z.string().trim().min(2).max(200).optional(),
        type: z.enum(DOC_TYPES).optional(),
        description: z.string().trim().max(5000).optional().nullable(),
        requiresSignature: z.boolean().optional(),
        visibleToClient: z.boolean().optional(),
        active: z.boolean().optional(),
        signerRoles: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const t = await prisma.documentTemplate.update({
      where: { id: current.id },
      data: {
        name: input.name,
        type: input.type,
        description: input.description === undefined ? undefined : input.description,
        requiresSignature: input.requiresSignature,
        visibleToClient: input.visibleToClient,
        active: input.active,
        signerRoles: input.signerRoles ? input.signerRoles.map((r) => r.trim().toUpperCase()).filter(Boolean) : undefined,
      },
      include: { _count: { select: { documents: true } } },
    });
    return ok(res, serialize(t), "Modelo atualizado");
  })
);

// DELETE /api/templates/:id
router.delete(
  "/:id",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!current) throw new NotFoundError("Modelo não encontrado");
    await storage.remove(current.storageKey).catch(() => undefined);
    await prisma.documentTemplate.delete({ where: { id: current.id } });
    return ok(res, { id: current.id }, "Modelo removido");
  })
);

// GET /api/templates/:id/download
router.get(
  "/:id/download",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const t = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!t) throw new NotFoundError("Modelo não encontrado");
    const signed = await storage.getSignedUrl(t.storageKey, t.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(t.storageKey);
    res.setHeader("Content-Type", t.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(t.fileName)}"`);
    stream.pipe(res);
  })
);

// POST /api/templates/:id/generate  { clientId, projectId? }
router.post(
  "/:id/generate",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const t = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!t) throw new NotFoundError("Modelo não encontrado");

    const input = z.object({ clientId: z.string().min(1), projectId: z.string().min(1).optional().nullable() }).parse(req.body);
    const client = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!client) throw new BadRequestError("Cliente inválido");
    let projectId: string | null = null;
    if (input.projectId) {
      const p = await prisma.project.findFirst({ where: { id: input.projectId, clientId: client.id, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!p) throw new BadRequestError("Projeto inválido para este cliente");
      projectId = p.id;
    }

    const bytes = await storage.getBytes(t.storageKey);
    const key = buildStorageKey(`clients/${client.id}`, t.fileName);
    await storage.put(key, bytes, t.mimeType);

    const doc = await prisma.projectDocument.create({
      data: {
        organizationId: req.user!.organizationId,
        projectId,
        clientId: client.id,
        templateId: t.id,
        type: t.type,
        title: t.name,
        description: t.description,
        storageKey: key,
        fileName: t.fileName,
        mimeType: t.mimeType,
        sizeBytes: bytes.byteLength,
        checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
        visibleToClient: t.visibleToClient,
        requiresSignature: t.requiresSignature,
        signerRoles: t.signerRoles,
        signatureStatus: t.requiresSignature ? "PENDING" : "NOT_REQUIRED",
        uploadedById: req.user!.id,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "DOCUMENT_GENERATED_FROM_TEMPLATE", entity: "ProjectDocument", entityId: doc.id, details: { templateId: t.id, clientId: client.id } },
    });
    return ok(res, { id: doc.id, title: doc.title, requiresSignature: doc.requiresSignature }, "Documento gerado para o cliente");
  })
);

export default router;
