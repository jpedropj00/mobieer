import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { getOrCreateOrder } from "./production.service";
import { createRequisition } from "../requisitions/requisitions.service";
import {
  PRODUCTION_SECTORS,
  SECTOR_LABEL,
  itemInclude,
  nextSector,
  sectorIndex,
  serializeItem,
  summarizeItems,
} from "./shopfloor.service";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, code: true, name: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
async function ensureItem(id: string, organizationId: string) {
  const it = await prisma.productionItem.findFirst({ where: { id, organizationId }, include: itemInclude });
  if (!it) throw new NotFoundError("Item de produção não encontrado");
  return it;
}

// GET /api/production/board?projectId=&sector=  -> quadro da fábrica por setor
router.get(
  "/board",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const items = await prisma.productionItem.findMany({
      where: {
        organizationId: req.user!.organizationId,
        status: "IN_PROGRESS",
        ...(req.query.projectId ? { order: { projectId: String(req.query.projectId) } } : {}),
        ...(req.query.sector ? { sector: req.query.sector as never } : {}),
      },
      include: itemInclude,
      orderBy: [{ position: "asc" }, { updatedAt: "asc" }],
    });
    const serial = items.map(serializeItem);
    const columns = PRODUCTION_SECTORS.map((s) => ({
      sector: s,
      label: SECTOR_LABEL[s],
      items: serial.filter((i) => i.sector === s),
    }));
    return ok(res, { columns });
  })
);

// GET /api/production/projects/:projectId/items
router.get(
  "/projects/:projectId/items",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const order = await prisma.productionOrder.findUnique({ where: { projectId: project.id }, select: { id: true } });
    if (!order) return ok(res, { items: [], summary: summarizeItems([]) });
    const items = await prisma.productionItem.findMany({
      where: { orderId: order.id },
      include: itemInclude,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return ok(res, {
      items: items.map(serializeItem),
      summary: summarizeItems(items.map((i) => ({ status: i.status, sector: i.sector }))),
    });
  })
);

// POST /api/production/projects/:projectId/items  -> item manual
router.post(
  "/projects/:projectId/items",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const order = await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);
    const input = z
      .object({
        descricao: z.string().trim().min(2).max(300),
        ambiente: z.string().trim().max(120).optional().nullable().or(z.literal("")),
        referencia: z.string().trim().max(120).optional().nullable().or(z.literal("")),
        quantidade: z.coerce.number().int().min(1).max(9999).default(1),
        material: z.string().trim().max(160).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    const max = await prisma.productionItem.aggregate({ where: { orderId: order.id }, _max: { position: true } });
    const item = await prisma.productionItem.create({
      data: {
        organizationId: req.user!.organizationId,
        orderId: order.id,
        descricao: input.descricao,
        ambiente: nn(input.ambiente),
        referencia: nn(input.referencia),
        quantidade: input.quantidade,
        material: nn(input.material),
        position: (max._max.position ?? 0) + 1,
        events: { create: { action: "NOTE", note: "Item criado manualmente", createdById: req.user!.id } },
      },
      include: itemInclude,
    });
    return ok(res, serializeItem(item), "Item adicionado");
  })
);

// POST /api/production/projects/:projectId/items/from-import/:importId
// Gera itens de produção a partir de um import do Promob já lido (status PARSED).
router.post(
  "/projects/:projectId/items/from-import/:importId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const imp = await prisma.promobImport.findFirst({
      where: { id: req.params.importId, organizationId: req.user!.organizationId, projectId: project.id },
    });
    if (!imp) throw new NotFoundError("Importação não encontrada");
    const parsed = imp.parsedJson as { itens?: { descricao?: string; referencia?: string | null; quantidade?: number | null; ambiente?: string | null }[] } | null;
    const itens = (parsed?.itens ?? []).filter((x) => x.descricao && x.descricao.trim());
    if (itens.length === 0) throw new BadRequestError("Este import não tem itens legíveis");

    const order = await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);
    const existing = await prisma.productionItem.findMany({
      where: { orderId: order.id, sourceImportId: imp.id },
      select: { referencia: true, descricao: true },
    });
    const seen = new Set(existing.map((e) => `${e.referencia ?? ""}|${e.descricao}`));
    const base = await prisma.productionItem.aggregate({ where: { orderId: order.id }, _max: { position: true } });
    let pos = base._max.position ?? 0;

    const toCreate = itens
      .filter((x) => !seen.has(`${x.referencia ?? ""}|${x.descricao!.trim()}`))
      .map((x) => ({
        organizationId: req.user!.organizationId,
        orderId: order.id,
        descricao: x.descricao!.trim().slice(0, 300),
        referencia: x.referencia?.trim().slice(0, 120) || null,
        ambiente: x.ambiente?.trim().slice(0, 120) || null,
        quantidade: x.quantidade && x.quantidade > 0 ? Math.min(9999, Math.round(x.quantidade)) : 1,
        sourceImportId: imp.id,
        position: ++pos,
      }));

    if (toCreate.length === 0) throw new BadRequestError("Todos os itens deste import já foram gerados");
    await prisma.productionItem.createMany({ data: toCreate });
    return ok(res, { created: toCreate.length, skipped: itens.length - toCreate.length }, `${toCreate.length} item(ns) gerado(s)`);
  })
);

// GET /api/production/projects/:projectId/requisitions
// Requisições de corte já geradas a partir da produção deste projeto.
router.get(
  "/projects/:projectId/requisitions",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const order = await prisma.productionOrder.findUnique({ where: { projectId: project.id }, select: { id: true } });
    if (!order) return ok(res, []);
    const rows = await prisma.requisition.findMany({
      where: { productionOrderId: order.id },
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        createdAt: true,
        neededAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        priority: r.priority,
        itemCount: r._count.items,
        createdAt: r.createdAt,
        neededAt: r.neededAt,
      }))
    );
  })
);

// POST /api/production/projects/:projectId/requisition
// Gera uma requisição de corte (DRAFT) com os itens ativos da produção.
router.post(
  "/projects/:projectId/requisition",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, organizationId: req.user!.organizationId },
      select: { id: true, code: true, name: true, client: { select: { name: true } } },
    });
    if (!project) throw new NotFoundError("Projeto não encontrado");
    const order = await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);

    const items = await prisma.productionItem.findMany({
      where: { orderId: order.id, status: { not: "CANCELLED" } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    if (items.length === 0) throw new BadRequestError("Não há itens de produção para requisitar");
    if (items.length > 200) throw new BadRequestError("Muitos itens (máx. 200 por requisição). Gere em lotes.");

    const created = await createRequisition(
      {
        clientName: project.client?.name ?? null,
        projectReference: project.code,
        priority: "NORMAL",
        note: `Gerada da produção — ${project.code} ${project.name}`.slice(0, 3000),
        submit: false,
        attachments: [],
        sector: null,
        destination: null,
        neededAt: null,
        responsibleId: null,
        items: items.map((it) => ({
          description: it.descricao.slice(0, 200),
          material: it.material ? it.material.slice(0, 150) : null,
          quantity: it.quantidade,
          unit: "UNIT" as const,
          note: [it.ambiente, it.referencia].filter(Boolean).join(" · ").slice(0, 1000) || null,
          productId: null,
          thickness: null,
          length: null,
          width: null,
          edgeFinish: null,
        })),
      },
      req.user!.id
    );

    await prisma.requisition.update({ where: { id: created.id }, data: { productionOrderId: order.id } });
    return ok(res, { id: created.id, number: created.number, itemCount: items.length }, `Requisição ${created.number} criada com ${items.length} peça(s)`);
  })
);

// PATCH /api/production/items/:id
router.patch(
  "/items/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureItem(req.params.id, req.user!.organizationId);
    const input = z
      .object({
        descricao: z.string().trim().min(2).max(300).optional(),
        ambiente: z.string().trim().max(120).optional().nullable().or(z.literal("")),
        referencia: z.string().trim().max(120).optional().nullable().or(z.literal("")),
        quantidade: z.coerce.number().int().min(1).max(9999).optional(),
        material: z.string().trim().max(160).optional().nullable().or(z.literal("")),
        notes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    const item = await prisma.productionItem.update({
      where: { id: cur.id },
      data: {
        descricao: input.descricao,
        ambiente: input.ambiente === undefined ? undefined : nn(input.ambiente),
        referencia: input.referencia === undefined ? undefined : nn(input.referencia),
        quantidade: input.quantidade,
        material: input.material === undefined ? undefined : nn(input.material),
        notes: input.notes === undefined ? undefined : nn(input.notes),
      },
      include: itemInclude,
    });
    return ok(res, serializeItem(item), "Item atualizado");
  })
);

// POST /api/production/items/:id/advance
//   action padrão:
//     PENDING           -> "start"    => entra no 1º setor (CORTE), IN_PROGRESS
//     IN_PROGRESS        -> "complete" => conclui o setor atual e vai para o próximo;
//                                         no último setor conclui o item (DONE)
//     qualquer           -> "jump" + sector  => move para o setor indicado
//     DONE/CANCELLED     -> "reopen"  => volta para IN_PROGRESS no último setor
//     qualquer           -> "cancel"
router.post(
  "/items/:id/advance",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureItem(req.params.id, req.user!.organizationId);
    const input = z
      .object({
        action: z.enum(["start", "complete", "jump", "reopen", "cancel"]).optional(),
        sector: z.enum(PRODUCTION_SECTORS).optional(),
        note: z.string().trim().max(1000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const now = new Date();
    const data: Prisma.ProductionItemUpdateInput = {};
    let eventSector: string | null = null;
    let eventAction = "NOTE";

    const action = input.action ?? (cur.status === "PENDING" ? "start" : input.sector ? "jump" : "complete");

    if (action === "cancel") {
      data.status = "CANCELLED";
      data.sector = null;
      eventAction = "CANCEL";
    } else if (action === "reopen") {
      if (cur.status !== "DONE" && cur.status !== "CANCELLED") throw new BadRequestError("O item não está concluído/cancelado");
      data.status = "IN_PROGRESS";
      data.sector = PRODUCTION_SECTORS[PRODUCTION_SECTORS.length - 1];
      data.completedAt = null;
      eventAction = "REOPEN";
      eventSector = PRODUCTION_SECTORS[PRODUCTION_SECTORS.length - 1];
    } else if (action === "jump") {
      if (!input.sector) throw new BadRequestError("Informe o setor de destino");
      data.status = "IN_PROGRESS";
      data.sector = input.sector;
      if (!cur.startedAt) data.startedAt = now;
      data.completedAt = null;
      eventAction = "JUMP";
      eventSector = input.sector;
    } else if (action === "start") {
      if (cur.status === "DONE") throw new BadRequestError("Item já concluído");
      data.status = "IN_PROGRESS";
      data.sector = PRODUCTION_SECTORS[0];
      data.startedAt = cur.startedAt ?? now;
      eventAction = "ENTER";
      eventSector = PRODUCTION_SECTORS[0];
    } else {
      // complete
      if (cur.status !== "IN_PROGRESS" || !cur.sector) throw new BadRequestError("O item não está em um setor");
      const next = nextSector(cur.sector);
      eventAction = "COMPLETE";
      eventSector = cur.sector;
      if (next) {
        data.sector = next;
      } else {
        data.status = "DONE";
        data.sector = null;
        data.completedAt = now;
      }
    }

    await prisma.productionItem.update({
      where: { id: cur.id },
      data: {
        ...data,
        events: { create: { action: eventAction, sector: eventSector as never, note: nn(input.note), createdById: req.user!.id } },
      },
    });
    const fresh = await prisma.productionItem.findUniqueOrThrow({ where: { id: cur.id }, include: itemInclude });
    return ok(res, serializeItem(fresh), "Item atualizado");
  })
);

// DELETE /api/production/items/:id
router.delete(
  "/items/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureItem(req.params.id, req.user!.organizationId);
    await prisma.productionItem.delete({ where: { id: cur.id } });
    return ok(res, { id: cur.id }, "Item removido");
  })
);

export default router;
