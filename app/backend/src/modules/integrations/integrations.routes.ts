import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadPromob } from "../../middlewares/upload";
import { notifyUser } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError, ValidationError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { createPromobImport, projectCodeFromFileName } from "../promob/promob.import";
import {
  INTEGRATION_SCOPES,
  authenticateIntegration,
  generateIntegrationToken,
  type IntegrationScope,
} from "./integration-token";

/** /api/integrations */
const router = Router();
const DAY_MS = 86400000;

// ============================ Gestão dos tokens ============================

const admin = [authenticate, requirePermission("settings.manage")];

// GET /api/integrations/tokens
router.get(
  "/tokens",
  ...admin,
  asyncHandler(async (req, res) => {
    const rows = await prisma.integrationToken.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    });
    return ok(res, {
      scopes: Object.entries(INTEGRATION_SCOPES).map(([key, label]) => ({ key, label })),
      tokens: rows.map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        scopes: t.scopes,
        lastUsedAt: t.lastUsedAt,
        revokedAt: t.revokedAt,
        createdAt: t.createdAt,
      })),
    });
  })
);

// POST /api/integrations/tokens { name, scopes } -> token puro só nesta resposta
router.post(
  "/tokens",
  ...admin,
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(80),
        scopes: z.array(z.enum(Object.keys(INTEGRATION_SCOPES) as [IntegrationScope, ...IntegrationScope[]])).min(1),
      })
      .parse(req.body);
    const { token, hash, prefix } = generateIntegrationToken();
    const row = await prisma.integrationToken.create({
      data: {
        organizationId: req.user!.organizationId,
        name: input.name,
        tokenHash: hash,
        prefix,
        scopes: [...new Set(input.scopes)],
        createdById: req.user!.id,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "INTEGRATION_TOKEN_CREATED", entity: "IntegrationToken", entityId: row.id, details: { name: row.name, scopes: row.scopes } },
    });
    return ok(res, { id: row.id, name: row.name, prefix, scopes: row.scopes, token }, "Token criado — copie agora, ele não será mostrado de novo");
  })
);

// DELETE /api/integrations/tokens/:id -> revoga
router.delete(
  "/tokens/:id",
  ...admin,
  asyncHandler(async (req, res) => {
    const row = await prisma.integrationToken.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!row) throw new NotFoundError("Token não encontrado");
    if (!row.revokedAt) await prisma.integrationToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "INTEGRATION_TOKEN_REVOKED", entity: "IntegrationToken", entityId: row.id },
    });
    return ok(res, { id: row.id }, "Token revogado");
  })
);

// ============================ Promob (plugin / sincronizador) ============================

const promob = authenticateIntegration("promob.import");

// GET /api/integrations/promob/ping -> teste de conexão
router.get(
  "/promob/ping",
  promob,
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.integration!.organizationId },
      select: { name: true, enterprise: { select: { tradeName: true } } },
    });
    return ok(res, { ok: true, organization: org?.enterprise.tradeName || org?.name, token: req.integration!.name });
  })
);

// GET /api/integrations/promob/projects?search=
router.get(
  "/promob/projects",
  promob,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const rows = await prisma.project.findMany({
      where: {
        organizationId: req.integration!.organizationId,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
        ...(search
          ? { OR: [{ code: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }, { client: { name: { contains: search, mode: "insensitive" } } }] }
          : {}),
      },
      select: { id: true, code: true, name: true, client: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return ok(res, rows.map((p) => ({ id: p.id, code: p.code, name: p.name, clientName: p.client.name })));
  })
);

// POST /api/integrations/promob/imports  (multipart: file + projectId? | projectCode?)
// Sem projeto informado, tenta pelo código no começo do nome do arquivo.
router.post(
  "/promob/imports",
  promob,
  uploadPromob.single("file"),
  asyncHandler(async (req, res) => {
    const organizationId = req.integration!.organizationId;
    if (!req.file) throw new ValidationError("Envie o arquivo exportado do Promob no campo 'file'");
    const input = z
      .object({ projectId: z.string().trim().min(1).optional(), projectCode: z.string().trim().min(1).max(40).optional() })
      .parse(req.body ?? {});

    let project: { id: string; code: string; name: string; managerId: string | null } | null = null;
    const select = { id: true, code: true, name: true, managerId: true } as const;
    if (input.projectId) {
      project = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select });
    } else if (input.projectCode) {
      project = await prisma.project.findFirst({ where: { organizationId, code: { equals: input.projectCode, mode: "insensitive" } }, select });
    } else {
      const codes = await prisma.project.findMany({
        where: { organizationId, status: { notIn: ["CANCELLED"] } },
        select: { code: true },
      });
      const code = projectCodeFromFileName(req.file.originalname, codes.map((c) => c.code));
      if (code) project = await prisma.project.findFirst({ where: { organizationId, code }, select });
    }
    if (!project) {
      throw new NotFoundError(
        "Projeto não encontrado. Informe projectId/projectCode ou comece o nome do arquivo com o código do projeto (ex.: \"364-1 Cozinha.xml\")."
      );
    }

    // Reenvio do mesmo arquivo (mesmo nome e tamanho, 30 dias) não duplica.
    const duplicate = await prisma.promobImport.findFirst({
      where: {
        organizationId,
        projectId: project.id,
        fileName: req.file.originalname,
        sizeBytes: req.file.size,
        createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
      },
      select: { id: true, status: true, itemCount: true, totalValue: true },
    });
    if (duplicate) {
      return ok(res, { importId: duplicate.id, project: { code: project.code, name: project.name }, duplicate: true, status: duplicate.status }, "Arquivo já importado anteriormente");
    }

    const row = await createPromobImport({ organizationId, projectId: project.id, file: req.file, createdById: null, source: "SYNC" });
    await notifyUser(
      project.managerId,
      "Orçamento do Promob recebido",
      `${project.code} — ${project.name}: ${row.fileName} chegou pelo sincronizador (${row.status === "PARSED" ? `${row.itemCount} itens` : "arquivo guardado"}).`
    );
    return ok(
      res,
      {
        importId: row.id,
        project: { code: project.code, name: project.name },
        duplicate: false,
        status: row.status,
        itemCount: row.itemCount,
        totalValue: row.totalValue != null ? Number(row.totalValue) : null,
        notes: row.notes,
      },
      row.status === "PARSED" ? `Importado: ${row.itemCount} item(ns)` : "Arquivo recebido"
    );
  })
);

export default router;
