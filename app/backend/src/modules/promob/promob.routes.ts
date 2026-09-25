import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadPromob } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storage } from "../../lib/storage";
import { createPromobImport } from "./promob.import";
import { readPromobFile } from "./promob.adapters";
import { pipeToResponse } from "../../utils/stream";

const router = Router();
router.use(authenticate);

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, code: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
async function ensureImport(id: string, organizationId: string) {
  const row = await prisma.promobImport.findFirst({ where: { id, organizationId } });
  if (!row) throw new NotFoundError("Importação não encontrada");
  return row;
}

const serialize = (r: {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  format: string;
  source?: string;
  status: string;
  itemCount: number;
  totalValue: Prisma.Decimal | null;
  parsedJson: unknown;
  notes: string | null;
  createdAt: Date;
  createdBy?: { id: string; name: string } | null;
}) => ({
  id: r.id,
  projectId: r.projectId,
  fileName: r.fileName,
  mimeType: r.mimeType,
  sizeBytes: r.sizeBytes,
  format: r.format,
  source: r.source ?? "MANUAL",
  status: r.status,
  itemCount: r.itemCount,
  totalValue: r.totalValue != null ? Number(r.totalValue) : null,
  parsed: r.parsedJson ?? null,
  notes: r.notes,
  createdAt: r.createdAt,
  createdBy: r.createdBy ?? null,
  downloadUrl: `/api/promob/imports/${r.id}/download`,
});

// GET /api/promob/projects/:projectId/imports
router.get(
  "/projects/:projectId/imports",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const rows = await prisma.promobImport.findMany({
      where: { projectId: req.params.projectId, organizationId: req.user!.organizationId },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serialize));
  })
);

// POST /api/promob/projects/:projectId/imports/preview   (multipart: file)
// §20 — lê o arquivo e devolve o que seria importado, SEM gravar nada. A tela
// mostra peças, materiais, colunas reconhecidas e avisos; só depois de
// confirmar o arquivo é enviado para a rota de importação abaixo.
router.post(
  "/projects/:projectId/imports/preview",
  requirePermission("organization.manage"),
  uploadPromob.single("file"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do Promob");
    const read = readPromobFile(req.file);
    return ok(res, { fileName: req.file.originalname, sizeBytes: req.file.size, ...read });
  })
);

// POST /api/promob/projects/:projectId/imports   (multipart: file)
router.post(
  "/projects/:projectId/imports",
  requirePermission("organization.manage"),
  uploadPromob.single("file"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do Promob");

    const row = await createPromobImport({
      organizationId: req.user!.organizationId,
      projectId: project.id,
      file: req.file,
      createdById: req.user!.id,
      source: "MANUAL",
    });
    return ok(res, serialize(row), row.status === "PARSED" ? `Importado: ${row.itemCount} item(ns)` : "Arquivo importado");
  })
);

router.get(
  "/imports/:id",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const row = await prisma.promobImport.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundError("Importação não encontrada");
    return ok(res, serialize(row));
  })
);

router.get(
  "/imports/:id/download",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const row = await ensureImport(req.params.id, req.user!.organizationId);
    const signed = await storage.getSignedUrl(row.storageKey, row.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(row.storageKey);
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

router.delete(
  "/imports/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const row = await ensureImport(req.params.id, req.user!.organizationId);
    await storage.remove(row.storageKey).catch(() => undefined);
    await prisma.promobImport.delete({ where: { id: row.id } });
    return ok(res, { id: row.id }, "Importação removida");
  })
);

export default router;
