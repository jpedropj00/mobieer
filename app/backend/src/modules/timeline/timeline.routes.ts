/**
 * Timeline e ambientes do projeto: /api/projects/:projectId/...
 *
 * A timeline nasce na primeira leitura, derivada dos dados reais, e depois é
 * sincronizada a cada leitura — mas só para frente, e nunca por cima do que
 * uma pessoa alterou. Toda edição manual vai para o histórico da etapa.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma, RoomType, StageStatus, TimelineStageKey } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { assertProjectAccess } from "../../lib/scope";
import { notifyUser } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { enumQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { loadTimelineFacts } from "./timeline.facts";
import {
  STAGE_AREA,
  STAGE_LABEL,
  TIMELINE_STAGES,
  applyStagePatch,
  currentStage,
  deriveTimeline,
  diffForHistory,
  isOverdue,
  positionOf,
  progressPercent,
  syncPlan,
} from "./timeline.service";

const router = Router({ mergeParams: true });
router.use(authenticate);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const txt = (v: string | null | undefined) => (typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim() || null : (v ?? null));

const stageInclude = {
  responsible: { select: { id: true, name: true } },
  events: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { createdAt: true, user: { select: { name: true } } },
  },
} satisfies Prisma.ProjectStageInclude;

/** Cria as etapas que faltam e avança as automáticas. Idempotente. */
export async function ensureTimeline(projectId: string, organizationId: string) {
  const facts = await loadTimelineFacts(projectId);
  if (!facts) throw new NotFoundError("Projeto não encontrado");
  const derived = deriveTimeline(facts);

  const existing = await prisma.projectStage.findMany({
    where: { projectId },
    select: { id: true, key: true, status: true, startedAt: true, completedAt: true, events: { where: { field: "status", userId: { not: null } }, select: { id: true }, take: 1 } },
  });
  const have = new Set(existing.map((e) => e.key));

  // 1. etapas que ainda não existem nascem do estado derivado
  const missing = derived.filter((d) => !have.has(d.key));
  if (missing.length) {
    await prisma.projectStage.createMany({
      data: missing.map((d) => ({
        organizationId,
        projectId,
        key: d.key,
        position: positionOf(d.key),
        status: d.status,
        startedAt: d.startedAt,
        completedAt: d.completedAt,
        notes: d.implied ? "Concluída por inferência: uma etapa posterior já foi registrada, mas esta não tem data própria no sistema." : null,
      })),
      skipDuplicates: true,
    });
  }

  // 2. as existentes só avançam, e só se ninguém mexeu à mão
  const plan = syncPlan(
    existing.map((e) => ({ key: e.key, status: e.status, startedAt: e.startedAt, completedAt: e.completedAt, manuallyEdited: e.events.length > 0 })),
    derived
  );
  for (const step of plan) {
    const stage = existing.find((e) => e.key === step.key)!;
    await prisma.$transaction([
      prisma.projectStage.update({
        where: { id: stage.id },
        data: { status: step.status, startedAt: step.startedAt, completedAt: step.completedAt },
      }),
      prisma.projectStageEvent.create({
        // userId nulo = sincronização automática (não conta como edição manual)
        data: { stageId: stage.id, userId: null, field: "status", fromValue: step.from, toValue: step.status, note: "Atualizado automaticamente a partir dos registros do projeto" },
      }),
    ]);
  }
}

function serializeStage(s: Prisma.ProjectStageGetPayload<{ include: typeof stageInclude }>, now = new Date()) {
  return {
    id: s.id,
    key: s.key,
    label: STAGE_LABEL[s.key],
    area: STAGE_AREA[s.key],
    position: s.position,
    status: s.status,
    overdue: isOverdue(s, now),
    responsible: s.responsible,
    plannedAt: s.plannedAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    notes: s.notes,
    lastChange: s.events[0] ? { at: s.events[0].createdAt, by: s.events[0].user?.name ?? "Sistema" } : null,
  };
}

// ===========================================================================
// Timeline
// ===========================================================================

// GET /api/projects/:projectId/timeline
router.get(
  "/timeline",
  requireAnyPermission(["timeline.read", "contractors.self"]),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess(projectId, req.user!);
    await ensureTimeline(projectId, req.user!.organizationId);

    const stages = await prisma.projectStage.findMany({ where: { projectId }, include: stageInclude, orderBy: { position: "asc" } });
    const list = stages.map((s) => serializeStage(s));
    const current = currentStage(list);
    return ok(res, {
      stages: list,
      current: current ? { key: current.key, label: current.label } : null,
      progress: progressPercent(list),
      overdueCount: list.filter((s) => s.overdue).length,
    });
  })
);

// PATCH /api/projects/:projectId/timeline/:key
router.patch(
  "/timeline/:key",
  requirePermission("timeline.edit"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    const key = enumQuery(req.params.key, TimelineStageKey, "etapa")!;
    await assertProjectAccess(projectId, req.user!);
    await ensureTimeline(projectId, req.user!.organizationId);

    const input = z
      .object({
        status: z.nativeEnum(StageStatus).optional(),
        responsibleId: z.string().min(1).nullable().optional(),
        plannedAt: z.coerce.date().nullable().optional(),
        completedAt: z.coerce.date().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        // por que a mudança: vai para o histórico
        reason: z.string().max(500).optional(),
      })
      .parse(req.body);

    if (input.responsibleId) {
      const u = await prisma.user.findFirst({ where: { id: input.responsibleId, organizationId: req.user!.organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!u) throw new BadRequestError("Responsável inválido");
    }

    const current = await prisma.projectStage.findUniqueOrThrow({ where: { projectId_key: { projectId, key } } });
    const data = applyStagePatch(current, { ...input, notes: input.notes === undefined ? undefined : txt(input.notes) });
    const changes = diffForHistory(current as unknown as Record<string, unknown>, data);
    if (!changes.length) return ok(res, null, "Nada mudou");

    await prisma.$transaction([
      prisma.projectStage.update({ where: { id: current.id }, data }),
      prisma.projectStageEvent.createMany({
        data: changes.map((c) => ({ stageId: current.id, userId: req.user!.id, ...c, note: txt(input.reason) })),
      }),
      prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: "PROJECT_STAGE_UPDATED",
          entity: "Project",
          entityId: projectId,
          details: { stage: key, changes } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    // quem passou a responder pela etapa fica sabendo
    if (input.responsibleId && input.responsibleId !== current.responsibleId && input.responsibleId !== req.user!.id) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { code: true, name: true } });
      await notifyUser(input.responsibleId, `Você é responsável por "${STAGE_LABEL[key]}"`, `${p?.code} · ${p?.name}`);
    }

    const updated = await prisma.projectStage.findUniqueOrThrow({ where: { id: current.id }, include: stageInclude });
    return ok(res, serializeStage(updated), `${STAGE_LABEL[key]} atualizada`);
  })
);

// GET /api/projects/:projectId/timeline/people -> quem pode ser responsável
// Só id, nome e perfil: quem edita a timeline não precisa de users.read para
// escolher o responsável, e não recebe e-mail nem dado pessoal de ninguém.
router.get(
  "/timeline/people",
  requirePermission("timeline.edit"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess(projectId, req.user!);
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, status: "ACTIVE", role: { name: { not: "MONTADOR" } } },
      select: { id: true, name: true, role: { select: { label: true } } },
      orderBy: { name: "asc" },
    });
    return ok(res, users.map((u) => ({ id: u.id, name: u.name, role: u.role.label })));
  })
);

// GET /api/projects/:projectId/timeline/:key/history
router.get(
  "/timeline/:key/history",
  requireAnyPermission(["timeline.read", "contractors.self"]),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    const key = enumQuery(req.params.key, TimelineStageKey, "etapa")!;
    await assertProjectAccess(projectId, req.user!);
    const stage = await prisma.projectStage.findUnique({ where: { projectId_key: { projectId, key } }, select: { id: true } });
    if (!stage) return ok(res, []);
    const events = await prisma.projectStageEvent.findMany({
      where: { stageId: stage.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    });
    return ok(
      res,
      events.map((e) => ({ id: e.id, field: e.field, fromValue: e.fromValue, toValue: e.toValue, note: e.note, createdAt: e.createdAt, by: e.user?.name ?? "Sistema" }))
    );
  })
);

// ===========================================================================
// Ambientes
// ===========================================================================

const roomInput = z.object({
  name: z.string().trim().min(1, "Informe o nome do ambiente").max(120),
  roomType: z.nativeEnum(RoomType).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  position: z.coerce.number().int().min(0).max(999).optional(),
});

router.get(
  "/rooms",
  requireAnyPermission(["timeline.read", "contractors.self"]),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess(projectId, req.user!);
    const rooms = await prisma.projectRoom.findMany({ where: { projectId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    return ok(res, rooms);
  })
);

router.post(
  "/rooms",
  requirePermission("timeline.edit"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params as { projectId: string };
    await assertProjectAccess(projectId, req.user!);
    const input = roomInput.parse(req.body);
    const count = await prisma.projectRoom.count({ where: { projectId } });
    if (count >= 60) throw new ValidationError("Limite de 60 ambientes por projeto");
    const room = await prisma.projectRoom.create({
      data: { projectId, name: txt(input.name)!, roomType: input.roomType ?? null, notes: txt(input.notes), position: input.position ?? count },
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "PROJECT_ROOM_CREATED", entity: "Project", entityId: projectId, details: { room: room.name } } });
    return ok(res, room, "Ambiente adicionado");
  })
);

router.patch(
  "/rooms/:roomId",
  requirePermission("timeline.edit"),
  asyncHandler(async (req, res) => {
    const { projectId, roomId } = req.params as { projectId: string; roomId: string };
    await assertProjectAccess(projectId, req.user!);
    const room = await prisma.projectRoom.findFirst({ where: { id: roomId, projectId } });
    if (!room) throw new NotFoundError("Ambiente não encontrado");
    const input = roomInput.partial().parse(req.body);
    const updated = await prisma.projectRoom.update({
      where: { id: room.id },
      data: {
        name: input.name === undefined ? undefined : txt(input.name)!,
        roomType: input.roomType,
        notes: input.notes === undefined ? undefined : txt(input.notes),
        position: input.position,
      },
    });
    return ok(res, updated, "Ambiente atualizado");
  })
);

router.delete(
  "/rooms/:roomId",
  requirePermission("timeline.edit"),
  asyncHandler(async (req, res) => {
    const { projectId, roomId } = req.params as { projectId: string; roomId: string };
    await assertProjectAccess(projectId, req.user!);
    const room = await prisma.projectRoom.findFirst({ where: { id: roomId, projectId } });
    if (!room) throw new NotFoundError("Ambiente não encontrado");
    await prisma.projectRoom.delete({ where: { id: room.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "PROJECT_ROOM_DELETED", entity: "Project", entityId: projectId, details: { room: room.name } } });
    return ok(res, { id: room.id }, "Ambiente removido");
  })
);

export default router;

/** Lista de etapas para a tela montar a legenda, sem depender de projeto. */
export const TIMELINE_META = TIMELINE_STAGES.map((key) => ({ key, label: STAGE_LABEL[key], area: STAGE_AREA[key] }));
