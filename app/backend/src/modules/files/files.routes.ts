/**
 * §55 — Arquivos ligados a qualquer entidade registrada em FILE_ENTITIES.
 * A permissão vem da entidade (ver files.service), não de um "files.*" genérico:
 * quem não enxerga a etapa/projeto também não enxerga o arquivo dela.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { uploadDocument } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { storage, buildStorageKey } from "../../lib/storage";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { pipeToResponse } from "../../utils/stream";
import { resolveFileEntity, serializeFile } from "./files.service";

const router = Router();
router.use(authenticate);

const include = { createdBy: { select: { id: true, name: true } } } as const;

// GET /api/files?entity=&entityId=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { entity, entityId } = z.object({ entity: z.string().min(1), entityId: z.string().min(1) }).parse(req.query);
    await resolveFileEntity(req.user!, entity, entityId, "read");
    const rows = await prisma.fileRecord.findMany({
      where: { organizationId: req.user!.organizationId, entity, entityId },
      include,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serializeFile));
  })
);

// POST /api/files  (multipart: file, entity, entityId, category?)
router.post(
  "/",
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({ entity: z.string().min(1), entityId: z.string().min(1), category: z.string().trim().max(40).optional().nullable() })
      .parse(req.body);
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    const target = await resolveFileEntity(req.user!, input.entity, input.entityId, "write");
    const key = buildStorageKey(`files/${input.entity}/${input.entityId}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    const row = await prisma.fileRecord.create({
      data: {
        organizationId: req.user!.organizationId,
        entity: input.entity,
        entityId: input.entityId,
        projectId: target.projectId,
        clientId: target.clientId,
        category: input.category || null,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageKey: key,
        createdById: req.user!.id,
      },
      include,
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "FILE_UPLOADED", entity: input.entity, entityId: input.entityId, details: { fileId: row.id, fileName: row.fileName } },
    });
    return ok(res, serializeFile(row), "Arquivo anexado");
  })
);

async function loadOwned(req: Request, mode: "read" | "write") {
  const f = await prisma.fileRecord.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
  if (!f) throw new NotFoundError("Arquivo não encontrado");
  await resolveFileEntity(req.user!, f.entity, f.entityId, mode);
  return f;
}

// GET /api/files/:id/download
router.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    const f = await loadOwned(req, "read");
    const signed = await storage.getSignedUrl(f.storageKey, f.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(f.storageKey);
    res.setHeader("Content-Type", f.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(f.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

// DELETE /api/files/:id
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const f = await loadOwned(req, "write");
    await prisma.fileRecord.delete({ where: { id: f.id } });
    await storage.remove(f.storageKey).catch(() => undefined);
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "FILE_DELETED", entity: f.entity, entityId: f.entityId, details: { fileId: f.id, fileName: f.fileName } },
    });
    return ok(res, { deleted: true }, "Arquivo removido");
  })
);

export default router;
