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
import { ForbiddenError, InvalidStateError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { storage } from "../../lib/storage";
import { dateQuery } from "../../utils/query";
import { pipeToResponse } from "../../utils/stream";
import { STATUS_LABEL as PART_STATUS_LABEL } from "../parts/parts.service";
import { uploadMedia } from "../../middlewares/upload";
import { acceptLocation, hourBank, performanceSummary, ratingAverage } from "../fieldwork/fieldwork.service";
import { createDiaryEntry, diaryInclude, diaryInput } from "../fieldwork/fieldwork.routes";
import { ok } from "../../utils/response";
import { localDay, localPeriod, shiftMinutes } from "./contractors.service";
import { currentTarget, finishTask, pauseTask, serializeTask, startTask, taskInclude } from "./installation.service";
import { ROOM_LABEL, buildProductivityReport, ownTargetMinutes } from "./productivity.service";

const router = Router();
router.use(authenticate, requirePermission("contractors.self"));

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Localização enviada pelo aparelho no ponto (opcional, com consentimento). */
const geoInput = z.object({
  locationConsent: z.boolean().optional(),
  lat: z.coerce.number().nullable().optional(),
  lng: z.coerce.number().nullable().optional(),
  accuracy: z.coerce.number().nullable().optional(),
});
const geoOf = (g: z.infer<typeof geoInput>) => ({ consent: g.locationConsent, lat: g.lat, lng: g.lng, accuracy: g.accuracy });
const deviceOf = (req: Request) => (req.header("user-agent") ?? "").slice(0, 200) || null;


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
    const { projectId, ...geo } = z.object({ projectId: z.string().min(1).optional().nullable() }).merge(geoInput).parse(req.body ?? {});
    const { consent, fix } = acceptLocation(geoOf(geo));
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
        locationConsent: consent,
        checkInLat: fix?.lat ?? null,
        checkInLng: fix?.lng ?? null,
        checkInAccuracy: fix?.accuracy ?? null,
        device: deviceOf(req),
      },
    });
    return ok(res, { id: shift.id, checkInAt: shift.checkInAt, located: Boolean(fix) }, fix ? "Entrada registrada com localização" : "Entrada registrada");
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
    const { consent, fix } = acceptLocation(geoOf(geoInput.parse(req.body ?? {})));
    const now = new Date();
    const minutes = shiftMinutes(open.checkInAt, now);
    await prisma.contractorShift.update({
      where: { id: open.id },
      data: {
        checkOutAt: now,
        minutes,
        // o consentimento vale por registro: dado na entrada não autoriza a saída
        checkOutLat: consent ? fix?.lat ?? null : null,
        checkOutLng: consent ? fix?.lng ?? null : null,
        checkOutAccuracy: consent ? fix?.accuracy ?? null : null,
      },
    });
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

// ===========================================================================
// Fase 7: solicitação de peças, documentos, agenda e notificações do montador
// ===========================================================================

/**
 * Tudo aqui é filtrado pelo cadastro do montador logado. Um montador nunca
 * enxerga solicitação, documento ou agenda de outro — e um montador desativado
 * nem passa do `me()`, que barra logo no começo.
 */

// GET /api/me/contractor/part-requests — as próprias solicitações
router.get(
  "/part-requests",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const rows = await prisma.partRequest.findMany({
      where: {
        organizationId: req.user!.organizationId,
        OR: [{ contractorId: c.id }, { createdById: req.user!.id }],
        ...(req.query.open === "true" ? { status: { notIn: ["CONCLUIDA", "RECUSADA", "CANCELADA"] } } : {}),
      },
      select: {
        id: true, number: true, title: true, status: true, priority: true,
        roomLabel: true, neededAt: true, refusalReason: true, createdAt: true,
        project: { select: { id: true, code: true, name: true } },
        _count: { select: { items: true, photos: true } },
      },
      orderBy: [{ neededAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
    });
    return ok(
      res,
      rows.map((r) => ({
        ...r,
        statusLabel: PART_STATUS_LABEL[r.status],
        itemCount: r._count.items,
        photoCount: r._count.photos,
      }))
    );
  })
);

// GET /api/me/contractor/documents — contrato e documentos pessoais
router.get(
  "/documents",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const docs = await prisma.contractorDocument.findMany({
      where: { contractorId: c.id },
      select: { id: true, kind: true, title: true, fileName: true, mimeType: true, size: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, docs);
  })
);

// GET /api/me/contractor/documents/:id/file
router.get(
  "/documents/:id/file",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const doc = await prisma.contractorDocument.findFirst({ where: { id: req.params.id, contractorId: c.id } });
    if (!doc) throw new NotFoundError("Documento não encontrado");
    const signed = await storage.getSignedUrl(doc.storageKey, doc.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

// GET /api/me/contractor/agenda?from=&to= — cômodos e visitas do período
router.get(
  "/agenda",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const from = dateQuery(req.query.from, "data inicial") ?? new Date();
    const to = dateQuery(req.query.to, "data final") ?? new Date(from.getTime() + 30 * 86400000);

    const [tarefas, turnos, solicitacoes] = await Promise.all([
      prisma.installationTask.findMany({
        where: { contractorId: c.id, status: { in: ["PENDING", "IN_PROGRESS", "PAUSED"] } },
        select: {
          id: true, roomType: true, roomLabel: true, status: true, startedAt: true,
          project: { select: { id: true, code: true, name: true, dueAt: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.contractorShift.findMany({
        where: { contractorId: c.id, checkInAt: { gte: from, lte: to } },
        select: { id: true, checkInAt: true, checkOutAt: true, minutes: true, project: { select: { id: true, code: true, name: true } } },
        orderBy: { checkInAt: "asc" },
      }),
      prisma.partRequest.findMany({
        where: { contractorId: c.id, neededAt: { gte: from, lte: to }, status: { notIn: ["CONCLUIDA", "RECUSADA", "CANCELADA"] } },
        select: { id: true, number: true, title: true, neededAt: true, status: true },
        orderBy: { neededAt: "asc" },
      }),
    ]);

    return ok(res, {
      periodo: { from, to },
      comodos: tarefas.map((t) => ({ ...t, roomLabel: t.roomLabel ?? ROOM_LABEL[t.roomType] })),
      turnos,
      solicitacoes: solicitacoes.map((s) => ({ ...s, statusLabel: PART_STATUS_LABEL[s.status] })),
    });
  })
);

// GET /api/me/contractor/notifications — as próprias notificações
router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    await me(req);
    const rows = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, type: true, title: true, message: true, read: true, link: true, createdAt: true },
    });
    const unread = await prisma.notification.count({ where: { userId: req.user!.id, read: false } });
    return ok(res, { items: rows, unreadCount: unread });
  })
);

// PATCH /api/me/contractor/notifications/:id/read
router.patch(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    await me(req);
    const updated = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { read: true },
    });
    if (!updated.count) throw new NotFoundError("Notificação não encontrada");
    return ok(res, { id: req.params.id, read: true });
  })
);

// ===========================================================================
// Fase 8.3: banco de horas, diário da obra e desempenho do próprio montador
// ===========================================================================

// GET /api/me/contractor/hour-bank?from&to
router.get(
  "/hour-bank",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const { from, to } = localPeriod(req.query.from, req.query.to, 30);
    const shifts = await prisma.contractorShift.findMany({ where: { contractorId: c.id, checkInAt: { gte: from, lt: to } }, select: { checkInAt: true, checkOutAt: true } });
    return ok(res, { period: { from, to }, expectedDailyMinutes: c.expectedDailyMinutes, ...hourBank(shifts, c.expectedDailyMinutes) });
  })
);

/** Obra em que o montador pode registrar diário: tem cômodo atribuído ou ponto nela. */
async function assertAssigned(contractorId: string, projectId: string) {
  const ok = await prisma.project.findFirst({
    where: { id: projectId, OR: [{ installationTasks: { some: { contractorId } } }, { contractorShifts: { some: { contractorId } } }] },
    select: { id: true, organizationId: true },
  });
  if (!ok) throw new ForbiddenError("Esta obra não está atribuída a você");
  return ok;
}

// GET /api/me/contractor/projects/:projectId/diary
router.get(
  "/projects/:projectId/diary",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    await assertAssigned(c.id, req.params.projectId);
    const rows = await prisma.installationDiaryEntry.findMany({ where: { projectId: req.params.projectId }, include: diaryInclude, orderBy: { createdAt: "desc" }, take: 100 });
    return ok(res, rows);
  })
);

// POST /api/me/contractor/projects/:projectId/diary (multipart)
router.post(
  "/projects/:projectId/diary",
  uploadMedia.array("files", 10),
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const project = await assertAssigned(c.id, req.params.projectId);
    // o montador registra em nome dele: contractorId vem do login, nunca do corpo
    const input = diaryInput.omit({ contractorId: true }).parse(req.body);
    const entry = await createDiaryEntry({
      organizationId: project.organizationId,
      projectId: project.id,
      authorId: req.user!.id,
      contractorId: c.id,
      input,
      files: (req.files as Express.Multer.File[]) ?? [],
    });
    return ok(res, entry, "Registro adicionado ao diário da obra");
  })
);

// GET /api/me/contractor/performance -> as próprias avaliações
router.get(
  "/performance",
  asyncHandler(async (req, res) => {
    const c = await me(req);
    const rows = await prisma.contractorRating.findMany({
      where: { contractorId: c.id },
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, {
      summary: performanceSummary(rows),
      history: rows.map((r) => ({ id: r.id, project: r.project, average: ratingAverage(r), rework: r.rework, notes: r.notes, createdAt: r.createdAt })),
    });
  })
);

export default router;
