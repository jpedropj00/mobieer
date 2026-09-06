import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import {
  PRODUCTION_STAGES,
  STAGE_LABEL,
  STAGE_TIMESTAMP,
  getOrCreateOrder,
  nextStage,
  orderInclude,
  serializeOrder,
  stageIndex,
} from "./production.service";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({
    where: { id, organizationId },
    select: { id: true, code: true, name: true, managerId: true, status: true, completedAt: true },
  });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
async function notify(userId: string | null | undefined, title: string, message: string) {
  if (!userId) return;
  await prisma.notification.create({ data: { type: "INFO", title, message, userId } });
}

// GET /api/production?stage=&all=1  -> painel da esteira
router.get(
  "/",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const stage = req.query.stage ? String(req.query.stage) : null;
    const showAll = req.query.all === "1" || req.query.all === "true";
    const rows = await prisma.productionOrder.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(stage ? { stage: stage as never } : showAll ? {} : { stage: { not: "DELIVERED" } }),
      },
      include: orderInclude,
      orderBy: [{ stage: "asc" }, { estimatedDeliveryAt: "asc" }, { updatedAt: "desc" }],
    });
    return ok(res, rows.map(serializeOrder));
  })
);

// GET /api/production/projects/:projectId  -> cria (se preciso) e retorna a ordem
router.get(
  "/projects/:projectId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const order = await getOrCreateOrder(req.params.projectId, req.user!.organizationId, req.user!.id);
    return ok(res, serializeOrder(order));
  })
);

// PATCH /api/production/projects/:projectId  -> previsão de entrega / observações
router.patch(
  "/projects/:projectId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);
    const input = z
      .object({
        estimatedDeliveryAt: z.coerce.date().optional().nullable(),
        notes: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const data: Prisma.ProductionOrderUpdateInput = {
      estimatedDeliveryAt: input.estimatedDeliveryAt === undefined ? undefined : input.estimatedDeliveryAt,
      notes: input.notes === undefined ? undefined : nn(input.notes),
    };
    await prisma.productionOrder.update({ where: { projectId: project.id }, data });
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { projectId: project.id }, include: orderInclude });
    return ok(res, serializeOrder(order), "Ordem de produção atualizada");
  })
);

// POST /api/production/projects/:projectId/advance  { stage?, note? }
// Sem "stage" -> avança para a próxima etapa. Com "stage" -> move para a etapa
// indicada (permite corrigir para uma etapa anterior).
router.post(
  "/projects/:projectId/advance",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const cur = await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);
    const input = z
      .object({
        stage: z.enum(PRODUCTION_STAGES).optional(),
        note: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const target = input.stage ?? nextStage(cur.stage);
    if (!target) throw new BadRequestError("O pedido já está na última etapa (Entregue)");
    if (target === cur.stage) throw new BadRequestError("O pedido já está nessa etapa");

    const now = new Date();
    const forward = stageIndex(target) > stageIndex(cur.stage);
    const tsField = STAGE_TIMESTAMP[target];
    const data: Prisma.ProductionOrderUpdateInput = {
      stage: target,
      events: {
        create: {
          stage: target,
          note: nn(input.note) ?? (forward ? null : `Etapa ajustada para "${STAGE_LABEL[target]}"`),
          createdById: req.user!.id,
        },
      },
    };
    // só grava o carimbo da etapa se ainda não houver (mantém a 1ª vez que passou por ela)
    if (forward && !cur[tsField]) data[tsField] = now;
    await prisma.productionOrder.update({ where: { id: cur.id }, data });

    // Ao entregar, conclui o projeto (se ainda não estiver concluído/cancelado).
    if (target === "DELIVERED" && project.status !== "COMPLETED" && project.status !== "CANCELLED") {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: "COMPLETED", completedAt: project.completedAt ?? now },
      });
    }

    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: cur.id }, include: orderInclude });

    if (forward && project.managerId && project.managerId !== req.user!.id) {
      await notify(
        project.managerId,
        "Produção — etapa avançada",
        `${project.code} — ${project.name}: agora em "${STAGE_LABEL[target]}".`
      );
    }
    return ok(res, serializeOrder(order), `Etapa atualizada para "${STAGE_LABEL[target]}"`);
  })
);

export default router;
