import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { APPLIANCE_CATEGORIES, getOrCreateSheet, serializeItem, serializeSheet } from "./appliances.service";

const router = Router();
router.use(authenticate);

const dim = z.coerce.number().min(0).max(9999).optional().nullable();
const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const decOrNull = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(Number(v).toFixed(1)));

const itemPatch = z.object({
  owned: z.boolean().optional(),
  willBuy: z.boolean().optional(),
  brandModel: z.string().trim().max(200).optional().nullable().or(z.literal("")),
  widthCm: dim,
  heightCm: dim,
  depthCm: dim,
  referenceUrl: z.string().trim().max(500).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
});

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

async function ensureItem(itemId: string, organizationId: string) {
  const item = await prisma.applianceItem.findFirst({
    where: { id: itemId, sheet: { organizationId } },
    include: { sheet: { select: { id: true, status: true } } },
  });
  if (!item) throw new NotFoundError("Item não encontrado");
  return item;
}

// GET /api/appliances/projects/:projectId  -> ficha (cria com itens padrão na 1ª vez)
router.get(
  "/projects/:projectId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const sheet = await getOrCreateSheet(req.params.projectId, req.user!.organizationId);
    const full = await prisma.applianceSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      include: {
        items: { orderBy: [{ position: "asc" }, { name: "asc" }] },
        reviewedBy: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true, client: { select: { name: true } } } },
      },
    });
    return ok(res, serializeSheet(full));
  })
);

// PATCH /api/appliances/projects/:projectId  -> cabeçalho + observações + status (REVIEWED)
router.patch(
  "/projects/:projectId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const sheet = await getOrCreateSheet(req.params.projectId, req.user!.organizationId);
    const input = z
      .object({
        projetista: z.string().trim().max(160).optional().nullable().or(z.literal("")),
        ambientes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
        notes: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
        status: z.enum(["DRAFT", "SUBMITTED", "REVIEWED"]).optional(),
      })
      .parse(req.body);

    const data: Prisma.ApplianceSheetUpdateInput = {
      projetista: input.projetista === undefined ? undefined : nn(input.projetista),
      ambientes: input.ambientes === undefined ? undefined : nn(input.ambientes),
      notes: input.notes === undefined ? undefined : nn(input.notes),
    };
    if (input.status) {
      data.status = input.status;
      if (input.status === "REVIEWED") {
        data.reviewedAt = new Date();
        data.reviewedBy = { connect: { id: req.user!.id } };
      }
    }
    await prisma.applianceSheet.update({ where: { id: sheet.id }, data });
    const full = await prisma.applianceSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      include: {
        items: { orderBy: [{ position: "asc" }, { name: "asc" }] },
        reviewedBy: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true, client: { select: { name: true } } } },
      },
    });
    return ok(res, serializeSheet(full), "Ficha atualizada");
  })
);

// POST /api/appliances/projects/:projectId/items  -> linha "Outros" manual
router.post(
  "/projects/:projectId/items",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const sheet = await getOrCreateSheet(req.params.projectId, req.user!.organizationId);
    const input = z
      .object({
        category: z.enum(APPLIANCE_CATEGORIES),
        name: z.string().trim().min(2).max(120),
      })
      .parse(req.body);
    const max = await prisma.applianceItem.aggregate({ where: { sheetId: sheet.id }, _max: { position: true } });
    const item = await prisma.applianceItem.create({
      data: { sheetId: sheet.id, category: input.category, name: input.name, custom: true, position: (max._max.position ?? 0) + 1 },
    });
    return ok(res, serializeItem(item), "Item adicionado");
  })
);

// PATCH /api/appliances/items/:itemId
router.patch(
  "/items/:itemId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const item = await ensureItem(req.params.itemId, req.user!.organizationId);
    const input = itemPatch.parse(req.body);
    const updated = await prisma.applianceItem.update({
      where: { id: item.id },
      data: {
        owned: input.owned,
        willBuy: input.willBuy,
        brandModel: input.brandModel === undefined ? undefined : nn(input.brandModel),
        widthCm: input.widthCm === undefined ? undefined : decOrNull(input.widthCm),
        heightCm: input.heightCm === undefined ? undefined : decOrNull(input.heightCm),
        depthCm: input.depthCm === undefined ? undefined : decOrNull(input.depthCm),
        referenceUrl: input.referenceUrl === undefined ? undefined : nn(input.referenceUrl),
        notes: input.notes === undefined ? undefined : nn(input.notes),
      },
    });
    return ok(res, serializeItem(updated), "Item atualizado");
  })
);

// DELETE /api/appliances/items/:itemId  (somente linhas manuais)
router.delete(
  "/items/:itemId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const item = await ensureItem(req.params.itemId, req.user!.organizationId);
    if (!item.custom) throw new BadRequestError("Só é possível remover itens adicionados manualmente");
    await prisma.applianceItem.delete({ where: { id: item.id } });
    return ok(res, { id: item.id }, "Item removido");
  })
);

export default router;
