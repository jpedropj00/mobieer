/**
 * §23/§24 — Etapas do pedido na fábrica (montado em /api/production).
 *
 * Ler: organization.read. Mexer na etapa: organization.manage ou
 * production.steps (perfil de corte/produção atualiza a própria etapa sem
 * precisar gerenciar a organização inteira).
 */
import { Router } from "express";
import { z } from "zod";
import { ProductionStepKey } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { projectScope } from "../../lib/scope";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { getOrCreateOrder } from "./production.service";
import { ensureSteps, ensureStepsForOpenOrders, impliedStage, loadStepDays, notifyStep, STEP_DAYS_SETTING, syncOrderStage } from "./steps.service";
import { STEP_LABEL, STEP_ORDER, STEP_STATUS_LABEL, daysLate, isOpenStep, nextStepStatus, type StepAction } from "./steps.rules";

const router = Router();
router.use(authenticate);

const canEdit = requireAnyPermission(["organization.manage", "production.steps"]);

const stepInclude = {
  responsible: { select: { id: true, name: true } },
  order: { select: { id: true, stage: true, project: { select: { id: true, code: true, name: true, managerId: true, client: { select: { name: true } } } } } },
} as const;

type StepRow = Awaited<ReturnType<typeof prisma.productionStep.findFirstOrThrow<{ include: typeof stepInclude }>>>;

function serializeStep(s: StepRow, fileCount: number, now = new Date()) {
  return {
    id: s.id,
    step: s.step,
    label: STEP_LABEL[s.step],
    position: s.position,
    status: s.status,
    statusLabel: STEP_STATUS_LABEL[s.status],
    responsible: s.responsible,
    startedAt: s.startedAt,
    dueAt: s.dueAt,
    completedAt: s.completedAt,
    notes: s.notes,
    blockedReason: s.blockedReason,
    daysLate: daysLate(s.dueAt, s.status, now),
    // prazo vence em até 1 dia e a etapa segue aberta
    dueSoon: isOpenStep(s.status) && !!s.dueAt && s.dueAt.getTime() >= now.getTime() && s.dueAt.getTime() - now.getTime() <= 86_400_000,
    fileCount,
    project: { id: s.order.project.id, code: s.order.project.code, name: s.order.project.name, clientName: s.order.project.client?.name ?? null },
  };
}

async function fileCounts(ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await prisma.fileRecord.groupBy({ by: ["entityId"], where: { entity: "ProductionStep", entityId: { in: ids } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.entityId, r._count._all]));
}

// GET /api/production/projects/:projectId/steps
router.get(
  "/projects/:projectId/steps",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({ where: { id: req.params.projectId, ...projectScope(req.user!) }, select: { id: true } });
    if (!project) throw new NotFoundError("Projeto não encontrado");
    const order = await getOrCreateOrder(project.id, req.user!.organizationId, req.user!.id);
    await ensureSteps(order.id);
    const steps = await prisma.productionStep.findMany({ where: { orderId: order.id }, include: stepInclude, orderBy: { position: "asc" } });
    const counts = await fileCounts(steps.map((s) => s.id));
    return ok(res, steps.map((s) => serializeStep(s, counts.get(s.id) ?? 0)));
  })
);

// GET /api/production/steps/overview?filter=late|blocked|due|open
// Painel da fábrica: etapas abertas de todos os pedidos, atrasadas primeiro.
router.get(
  "/steps/overview",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const filter = String(req.query.filter ?? "open");
    await ensureStepsForOpenOrders(req.user!.organizationId);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const steps = await prisma.productionStep.findMany({
      where: {
        order: { organizationId: req.user!.organizationId, stage: { not: "DELIVERED" }, project: projectScope(req.user!) },
        ...(filter === "blocked"
          ? { status: "BLOCKED" }
          : filter === "late"
            ? { status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, dueAt: { lt: now } }
            : filter === "due"
              ? { status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, dueAt: { gte: now, lte: tomorrow } }
              : { status: { in: ["IN_PROGRESS", "BLOCKED"] } }),
      },
      include: stepInclude,
      orderBy: [{ dueAt: "asc" }],
      take: 300,
    });
    const counts = await fileCounts(steps.map((s) => s.id));
    const [late, blocked, dueSoon] = await Promise.all([
      prisma.productionStep.count({
        where: { order: { organizationId: req.user!.organizationId, stage: { not: "DELIVERED" } }, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, dueAt: { lt: now } },
      }),
      prisma.productionStep.count({ where: { order: { organizationId: req.user!.organizationId, stage: { not: "DELIVERED" } }, status: "BLOCKED" } }),
      prisma.productionStep.count({
        where: {
          order: { organizationId: req.user!.organizationId, stage: { not: "DELIVERED" } },
          status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
          dueAt: { gte: now, lte: tomorrow },
        },
      }),
    ]);
    return ok(res, { counts: { late, blocked, dueSoon }, steps: steps.map((s) => serializeStep(s, counts.get(s.id) ?? 0, now)) });
  })
);

const patchSchema = z.object({
  action: z.enum(["START", "COMPLETE", "BLOCK", "UNBLOCK", "SKIP", "REOPEN"]).optional(),
  reason: z.string().trim().max(2000).optional().nullable(),
  responsibleId: z.string().min(1).optional().nullable(),
  dueAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

// PATCH /api/production/steps/:id
router.patch(
  "/steps/:id",
  canEdit,
  asyncHandler(async (req, res) => {
    const input = patchSchema.parse(req.body);
    const cur = await prisma.productionStep.findFirst({
      where: { id: req.params.id, order: { organizationId: req.user!.organizationId, project: projectScope(req.user!) } },
      include: stepInclude,
    });
    if (!cur) throw new NotFoundError("Etapa não encontrada");
    if (cur.order.stage === "DELIVERED") throw new BadRequestError("Pedido já entregue: as etapas estão encerradas");

    if (input.responsibleId) {
      const u = await prisma.user.findFirst({ where: { id: input.responsibleId, organizationId: req.user!.organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!u) throw new BadRequestError("Responsável inválido");
    }

    const now = new Date();
    const data: Record<string, unknown> = {};
    let status = cur.status;
    if (input.action) {
      const t = nextStepStatus(cur.status, input.action as StepAction);
      if (!t.ok) throw new BadRequestError(t.motivo);
      if (input.action === "BLOCK" && !input.reason) throw new BadRequestError("Informe o motivo do bloqueio");
      status = t.status;
      data.status = status;
      if (input.action === "START" || (input.action === "COMPLETE" && !cur.startedAt)) data.startedAt = cur.startedAt ?? now;
      if (input.action === "COMPLETE") data.completedAt = now;
      if (input.action === "REOPEN") data.completedAt = null;
      if (input.action === "BLOCK") data.blockedReason = input.reason;
      if (input.action === "UNBLOCK") data.blockedReason = null;
    }
    if (input.responsibleId !== undefined) data.responsibleId = input.responsibleId;
    if (input.dueAt !== undefined) {
      data.dueAt = input.dueAt;
      // prazo novo reabre o ciclo de avisos
      data.lastAlertKind = null;
      data.lastAlertAt = null;
    }
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (!Object.keys(data).length) throw new BadRequestError("Nada para alterar");

    const updated = await prisma.productionStep.update({ where: { id: cur.id }, data, include: stepInclude });
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: input.action ? `PRODUCTION_STEP_${input.action}` : "PRODUCTION_STEP_UPDATED",
        entity: "ProductionStep",
        entityId: cur.id,
        details: {
          project: cur.order.project.code,
          step: cur.step,
          before: { status: cur.status, responsibleId: cur.responsible?.id ?? null, dueAt: cur.dueAt },
          after: { status, responsibleId: updated.responsible?.id ?? null, dueAt: updated.dueAt },
          reason: input.reason ?? null,
        },
      },
    });

    const p = cur.order.project;
    const label = STEP_LABEL[cur.step];
    if (input.action === "BLOCK") {
      await notifyStep({
        organizationId: req.user!.organizationId,
        responsibleId: updated.responsible?.id ?? null,
        managerId: p.managerId,
        title: "Etapa de produção bloqueada",
        message: `${p.code} — ${p.name}: "${label}" bloqueada por ${req.user!.name}. Motivo: ${input.reason}`,
        excludeUserId: req.user!.id,
      });
    }
    if (input.responsibleId && input.responsibleId !== cur.responsible?.id && input.responsibleId !== req.user!.id) {
      await prisma.notification.create({
        data: { type: "INFO", userId: input.responsibleId, title: "Etapa de produção atribuída", message: `${p.code} — ${p.name}: você é responsável por "${label}".` },
      });
    }
    if (input.action === "START" || input.action === "COMPLETE") {
      await syncOrderStage(cur.order.id, impliedStage(cur.step, input.action), req.user!.id, `${label} ${input.action === "START" ? "iniciada" : "concluída"}`);
    }

    const counts = await fileCounts([cur.id]);
    return ok(res, serializeStep(updated, counts.get(cur.id) ?? 0), input.action ? `${label}: ${STEP_STATUS_LABEL[status].toLowerCase()}` : "Etapa atualizada");
  })
);

// GET /api/production/step-days — prazo padrão de cada etapa (dias úteis)
router.get(
  "/step-days",
  requirePermission("organization.read"),
  asyncHandler(async (_req, res) => {
    const days = await loadStepDays();
    return ok(res, STEP_ORDER.map((k) => ({ step: k, label: STEP_LABEL[k], days: days[k] })));
  })
);

// PUT /api/production/step-days { PLANO_CORTE: 1, ... } — vale para pedidos novos
router.put(
  "/step-days",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const input = z.record(z.nativeEnum(ProductionStepKey), z.coerce.number().int().min(0).max(60)).parse(req.body);
    const merged = { ...(await loadStepDays()), ...input };
    await prisma.setting.upsert({ where: { key: STEP_DAYS_SETTING }, create: { key: STEP_DAYS_SETTING, value: JSON.stringify(merged) }, update: { value: JSON.stringify(merged) } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "PRODUCTION_STEP_DAYS_UPDATED", entity: "Setting", entityId: STEP_DAYS_SETTING, details: merged } });
    return ok(res, STEP_ORDER.map((k) => ({ step: k, label: STEP_LABEL[k], days: merged[k] })), "Prazos padrão salvos (valem para pedidos novos)");
  })
);

export default router;
