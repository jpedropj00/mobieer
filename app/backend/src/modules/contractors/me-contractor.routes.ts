/**
 * Área do montador logado: /api/me/contractor
 * Só enxerga os próprios dados (ligação User -> Contractor).
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { RoomType } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ForbiddenError, InvalidStateError, ValidationError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { localDay, localPeriod, shiftMinutes } from "./contractors.service";
import { currentTarget, finishTask, pauseTask, serializeTask, startTask, taskInclude } from "./installation.service";
import { ROOM_LABEL, buildProductivityReport, ownTargetMinutes } from "./productivity.service";

const router = Router();
router.use(authenticate, requirePermission("contractors.self"));

const num = (v: unknown) => Number(v ?? 0) || 0;

async function me(req: Request) {
  const c = await prisma.contractor.findFirst({
    where: { userId: req.user!.id, organizationId: req.user!.organizationId },
  });
  if (!c) throw new ForbiddenError("Seu usuário não está ligado a um cadastro de montador. Fale com a gestão.");
  if (!c.active) throw new ForbiddenError("Seu cadastro de montador está inativo");
  return c;
}

/** Obras que o montador pode escolher: em entrega/montagem ou com cômodo atribuído a ele. */
async function availableProjects(organizationId: string, contractorId: string) {
  return prisma.project.findMany({
    where: {
      organizationId,
      status: { notIn: ["CANCELLED"] },
      OR: [
        { productionOrder: { stage: { in: ["PRE_ASSEMBLY", "OUT_FOR_DELIVERY"] } } },
        { installationTasks: { some: { contractorId, status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } } } },
      ],
    },
    select: { id: true, code: true, name: true, client: { select: { name: true, address: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}

// GET /api/me/contractor -> painel do dia
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const [openShift, tasks, projects] = await Promise.all([
      prisma.contractorShift.findFirst({
        where: { contractorId: c.id, checkOutAt: null },
        include: { project: { select: { id: true, code: true, name: true } } },
      }),
      prisma.installationTask.findMany({
        where: { contractorId: c.id, OR: [{ status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } }, { status: "DONE", review: "PENDING" }] },
        include: taskInclude,
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      }),
      availableProjects(req.user!.organizationId, c.id),
    ]);
    return ok(res, {
      contractor: { id: c.id, name: c.name, specialty: c.specialty, dailyRate: num(c.dailyRate) },
      openShift: openShift
        ? { id: openShift.id, checkInAt: openShift.checkInAt, project: openShift.project, day: localDay(openShift.checkInAt) }
        : null,
      tasks: tasks.map((t) => serializeTask(t)),
      projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, clientName: p.client.name, address: p.client.address })),
      roomTypes: Object.entries(ROOM_LABEL).map(([key, label]) => ({ key, label })),
    });
  })
);

// POST /api/me/contractor/check-in { projectId? }
router.post(
  "/check-in",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const { projectId } = z.object({ projectId: z.string().min(1).optional().nullable() }).parse(req.body ?? {});
    const open = await prisma.contractorShift.findFirst({ where: { contractorId: c.id, checkOutAt: null }, select: { id: true } });
    if (open) throw new InvalidStateError("Você já está com o ponto aberto");
    if (projectId) {
      const allowed = await availableProjects(req.user!.organizationId, c.id);
      if (!allowed.some((p) => p.id === projectId)) throw new ValidationError("Obra não disponível para você");
    }
    const shift = await prisma.contractorShift.create({
      data: {
        organizationId: req.user!.organizationId,
        contractorId: c.id,
        projectId: projectId ?? null,
        checkInAt: new Date(),
        dailyRate: c.dailyRate,
        createdById: req.user!.id,
      },
    });
    return ok(res, { id: shift.id, checkInAt: shift.checkInAt }, "Entrada registrada");
  })
);

// POST /api/me/contractor/check-out
router.post(
  "/check-out",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const open = await prisma.contractorShift.findFirst({ where: { contractorId: c.id, checkOutAt: null } });
    if (!open) throw new InvalidStateError("Você não está com o ponto aberto");
    const running = await prisma.installationTask.findFirst({ where: { contractorId: c.id, status: "IN_PROGRESS" }, select: { id: true } });
    if (running) throw new InvalidStateError("Pause ou conclua o cômodo em andamento antes de sair");
    const now = new Date();
    const minutes = shiftMinutes(open.checkInAt, now);
    await prisma.contractorShift.update({ where: { id: open.id }, data: { checkOutAt: now, minutes } });
    return ok(res, { minutes }, `Saída registrada — ${(minutes / 60).toFixed(1).replace(".", ",")}h`);
  })
);

// POST /api/me/contractor/tasks { projectId, roomType, roomLabel? } -> montador registra o cômodo
router.post(
  "/tasks",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const input = z
      .object({ projectId: z.string().min(1), roomType: z.nativeEnum(RoomType), roomLabel: z.string().trim().max(120).optional().nullable() })
      .parse(req.body);
    const allowed = await availableProjects(req.user!.organizationId, c.id);
    if (!allowed.some((p) => p.id === input.projectId)) throw new ValidationError("Obra não disponível para você");
    const t = await prisma.installationTask.create({
      data: {
        organizationId: req.user!.organizationId,
        contractorId: c.id,
        projectId: input.projectId,
        roomType: input.roomType,
        roomLabel: input.roomLabel || null,
        createdById: req.user!.id,
      },
      include: taskInclude,
    });
    return ok(res, serializeTask(t), "Cômodo adicionado");
  })
);

// POST /api/me/contractor/tasks/:id/(start|pause|finish)
router.post(
  "/tasks/:id/:action(start|pause|finish)",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const scope = { contractorId: c.id };
    const action = req.params.action as "start" | "pause" | "finish";
    if (action === "start") {
      const shift = await prisma.contractorShift.findFirst({ where: { contractorId: c.id, checkOutAt: null }, select: { id: true } });
      if (!shift) throw new InvalidStateError("Registre a entrada (check-in) antes de iniciar um cômodo");
    }
    const notes = z.object({ notes: z.string().trim().max(2000).optional().nullable() }).parse(req.body ?? {}).notes;
    const t =
      action === "start" ? await startTask(req.params.id, scope) : action === "pause" ? await pauseTask(req.params.id, scope) : await finishTask(req.params.id, scope, notes ?? undefined);
    const msg = { start: "Cronômetro iniciado", pause: "Cômodo pausado", finish: "Cômodo concluído — aguardando validação da gestão" }[action];
    return ok(res, serializeTask(t), msg);
  })
);

// GET /api/me/contractor/productivity?from=&to=
router.get(
  "/productivity",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const { from, to } = localPeriod(req.query.from, req.query.to, 90);
    const [done, bonuses, allApproved] = await Promise.all([
      prisma.installationTask.findMany({
        where: { contractorId: c.id, status: "DONE", review: "APPROVED", finishedAt: { gte: from, lte: to } },
        select: { roomType: true, workedMinutes: true, targetMinutes: true, finishedAt: true, bonus: { select: { amount: true, status: true } } },
      }),
      prisma.contractorBonus.findMany({
        where: { contractorId: c.id, createdAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
        include: { task: { select: { roomLabel: true, project: { select: { code: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.installationTask.findMany({
        where: { contractorId: c.id, status: "DONE", review: "APPROVED" },
        orderBy: { finishedAt: "desc" },
        select: { roomType: true, workedMinutes: true },
      }),
    ]);

    const report = buildProductivityReport(
      done.map((t) => ({
        contractorId: c.id,
        contractorName: c.name,
        roomType: t.roomType,
        workedMinutes: t.workedMinutes,
        targetMinutes: t.targetMinutes,
        finishedAt: t.finishedAt,
        bonusAmount: t.bonus && t.bonus.status !== "CANCELLED" ? num(t.bonus.amount) : 0,
      }))
    );

    // Meta vigente por tipo de cômodo (toda a história, não só o período).
    const { minSamples } = await currentTarget(req.user!.organizationId, c.id, "OUTRO");
    const byType = new Map<string, number[]>();
    for (const t of allApproved) byType.set(t.roomType, [...(byType.get(t.roomType) ?? []), t.workedMinutes]);
    const targets = [...byType.entries()].map(([roomType, history]) => ({
      roomType,
      label: ROOM_LABEL[roomType as RoomType],
      samples: history.length,
      targetMinutes: ownTargetMinutes(history, minSamples),
      missingForTarget: Math.max(0, minSamples - history.length),
    }));

    return ok(res, {
      from,
      to,
      summary: report.contractors[0] ?? { rooms: 0, hours: 0, avgGainPct: null, roomsAboveTarget: 0, bonusTotal: 0, byRoom: [] },
      targets,
      minSamples,
      bonuses: bonuses.map((b) => ({
        id: b.id,
        roomTypeLabel: ROOM_LABEL[b.roomType],
        roomLabel: b.task.roomLabel,
        projectCode: b.task.project.code,
        gainPct: num(b.gainPct),
        amount: num(b.amount),
        status: b.status,
        createdAt: b.createdAt,
      })),
      bonusPending: bonuses.filter((b) => b.status === "APPROVED").reduce((a, b) => a + num(b.amount), 0),
      bonusPaid: bonuses.filter((b) => b.status === "PAID").reduce((a, b) => a + num(b.amount), 0),
    });
  })
);

export default router;
