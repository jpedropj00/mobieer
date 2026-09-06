import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadPromob } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storage, buildStorageKey } from "../../lib/storage";
import { decodeXmlBuffer, detectFormat, parsePromobXml } from "./promob.service";

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
  status: string;
  itemCount: number;
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
  status: r.status,
  itemCount: r.itemCount,
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

// POST /api/promob/projects/:projectId/imports   (multipart: file)
router.post(
  "/projects/:projectId/imports",
  requirePermission("organization.manage"),
  uploadPromob.single("file"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do Promob");

    const format = detectFormat(req.file.originalname, req.file.mimetype);
    const key = buildStorageKey(project.id, `promob-${req.file.originalname}`);
    await storage.put(key, req.file.buffer, req.file.mimetype || "application/octet-stream");

    let status = "UPLOADED";
    let itemCount = 0;
    let parsed: unknown = null;
    let notes: string | null = null;

    if (format === "XML") {
      try {
        const p = parsePromobXml(decodeXmlBuffer(req.file.buffer));
        parsed = p;
        itemCount = p.totals.itens;
        status = p.totals.itens > 0 || p.totals.ambientes > 0 ? "PARSED" : "PARSE_FAILED";
        if (status === "PARSE_FAILED") notes = "XML lido, mas nenhum <ITEM>/<AMBIENTE> reconhecido nesta versão de export.";
      } catch (e) {
        status = "PARSE_FAILED";
        notes = `Falha ao ler o XML: ${e instanceof Error ? e.message : e}`;
      }
    } else if (format === "PDF") {
      notes = "PDF armazenado. A extração automática de itens só é feita para o XML de orçamento do Promob.";
    } else {
      notes = "Formato não reconhecido — arquivo armazenado para conferência manual.";
    }

    const row = await prisma.promobImport.create({
      data: {
        organizationId: req.user!.organizationId,
        projectId: project.id,
        fileName: req.file.originalname,
        storageKey: key,
        mimeType: req.file.mimetype || "application/octet-stream",
        sizeBytes: req.file.size,
        format,
        status,
        itemCount,
        parsedJson: parsed === null ? Prisma.DbNull : (parsed as Prisma.InputJsonValue),
        notes,
        createdById: req.user!.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return ok(res, serialize(row), status === "PARSED" ? `Importado: ${itemCount} item(ns)` : "Arquivo importado");
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
    stream.pipe(res);
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
