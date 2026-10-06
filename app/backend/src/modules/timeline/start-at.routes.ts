/**
 * Projeto já em andamento: /api/projects/:projectId/timeline/start-at
 *
 *   GET   etapas em que dá para começar (com o nome de cada uma)
 *   POST  { stage, note? } — conclui as etapas anteriores, deixa a atual em andamento
 *         e, se o projeto já está na fábrica ou depois dela, abre o pedido de produção
 *         na etapa correspondente. Dali em diante o projeto segue o fluxo normal.
 */
import { Router } from "express";
import { ProductionStage, StageStatus, TimelineStageKey } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { assertProjectAccess } from "../../lib/scope";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { getOrCreateOrder } from "../production/production.service";
import { ensureTimeline } from "./timeline.routes";
import { STAGE_LABEL } from "./timeline.service";
import { START_STAGES, startAtPlan } from "./start-at.rules";

const router = Router({ mergeParams: true });
router.use(authenticate);

const ORDER_STAGES: ProductionStage[] = ["RELEASED", "IN_PRODUCTION", "PRE_ASSEMBLY", "OUT_FOR_DELIVERY", "DELIVERED"];
const ORDER_DATE: Record<ProductionStage, string> = { RELEASED: "releasedAt", IN_PRODUCTION: "productionStartedAt", PRE_ASSEMBLY: "preAssemblyAt", OUT_FOR_DELIVERY: "outForDeliveryAt", DELIVERED: "deliveredAt" };

router.get(
  "/timeline/start-at",
  requirePermission("organization.read"),
  asyncHandler(async (_req, res) => ok(res, START_STAGES.map((key) => ({ key, label: STAGE_LABEL[key] }))))
);

router.post(
  "/timeline/start-at",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    const organizationId = req.user!.organizationId;
    const input = z.object({ stage: z.nativeEnum(TimelineStageKey), note: z.string().trim().max(300).optional() }).parse(req.body);
    if (!START_STAGES.includes(input.stage)) throw new BadRequestError("Escolha uma etapa do fluxo do projeto.");
    await assertProjectAccess(projectId, req.user!);
    await ensureTimeline(projectId, organizationId);

    const stages = await prisma.projectStage.findMany({ where: { projectId }, select: { id: true, key: true, status: true, startedAt: true } });
    const plan = startAtPlan(stages, input.stage);
    const byKey = new Map(stages.map((s) => [s.key, s]));
    const now = new Date();
    const note = input.note || "Projeto cadastrado já em andamento";

    await prisma.$transaction(async (tx) => {
      for (const key of plan.conclude) {
        const s = byKey.get(key)!;
        await tx.projectStage.update({ where: { id: s.id }, data: { status: StageStatus.CONCLUIDA, startedAt: s.startedAt ?? now, completedAt: now } });
        // com autor: a sincronização automática não reabre o que a loja informou
        await tx.projectStageEvent.create({ data: { stageId: s.id, userId: req.user!.id, field: "status", fromValue: s.status, toValue: StageStatus.CONCLUIDA, note } });
      }
      if (plan.start) {
        const s = byKey.get(plan.start)!;
        await tx.projectStage.update({ where: { id: s.id }, data: { status: StageStatus.EM_ANDAMENTO, startedAt: s.startedAt ?? now } });
        // sem autor: a etapa atual continua livre para o sistema concluir quando o fato acontecer
        await tx.projectStageEvent.create({ data: { stageId: s.id, userId: null, field: "status", fromValue: s.status, toValue: StageStatus.EM_ANDAMENTO, note: `${note} (informado por ${req.user!.name})` } });
      }
      await tx.project.updateMany({ where: { id: projectId, status: "PLANNING" }, data: { status: "ACTIVE", startAt: now } });
      await tx.auditLog.create({ data: { userId: req.user!.id, action: "PROJECT_STARTED_AT_STAGE", entity: "Project", entityId: projectId, details: { stage: input.stage, concluded: plan.conclude } } });
    });

    // já está na fábrica (ou depois): o pedido de produção nasce na etapa certa, sem avisar o cliente de novo
    let production: string | null = null;
    if (plan.productionStage) {
      const order = await getOrCreateOrder(projectId, organizationId, req.user!.id);
      const target = plan.productionStage;
      if (ORDER_STAGES.indexOf(order.stage) < ORDER_STAGES.indexOf(target)) {
        const dates: Record<string, Date> = {};
        for (const st of ORDER_STAGES.slice(1, ORDER_STAGES.indexOf(target) + 1)) {
          if (!(order as unknown as Record<string, Date | null>)[ORDER_DATE[st]]) dates[ORDER_DATE[st]] = now;
        }
        await prisma.productionOrder.update({ where: { id: order.id }, data: { stage: target, ...dates, events: { create: { stage: target, note, createdById: req.user!.id } } } });
      }
      production = target;
    }

    return ok(res, { stage: input.stage, concluded: plan.conclude.length, production }, `Projeto colocado em "${STAGE_LABEL[input.stage]}". As etapas anteriores ficaram concluídas.`);
  })
);

export default router;
