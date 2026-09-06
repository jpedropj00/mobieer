import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { MEASUREMENT_PERIODS, serializeVisit, techProjectDueDate, visitInclude } from "./measurements.service";
import { notifyClientWhatsApp } from "../../lib/client-comms";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, managerId: true, code: true, name: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
async function ensureVisit(id: string, organizationId: string) {
  const v = await prisma.measurementVisit.findFirst({ where: { id, organizationId }, include: visitInclude });
  if (!v) throw new NotFoundError("Medição não encontrada");
  return v;
}
async function notify(userId: string | null | undefined, title: string, message: string) {
  if (!userId) return;
  await prisma.notification.create({ data: { type: "INFO", title, message, userId } });
}

// GET /api/measurements?status=&projectId=
router.get(
  "/",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.measurementVisit.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.status ? { status: req.query.status as never } : {}),
        ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      },
      include: visitInclude,
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }, { createdAt: "desc" }],
    });
    return ok(res, rows.map(serializeVisit));
  })
);

// GET /api/measurements/projects/:projectId  -> histórico do projeto (mais recente primeiro)
router.get(
  "/projects/:projectId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const rows = await prisma.measurementVisit.findMany({
      where: { projectId: req.params.projectId, organizationId: req.user!.organizationId },
      include: visitInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serializeVisit));
  })
);

// POST /api/measurements/projects/:projectId  -> equipe cria/agenda direto
router.post(
  "/projects/:projectId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const input = z
      .object({
        scheduledAt: z.coerce.date().optional().nullable(),
        technicianId: z.string().min(1).optional().nullable(),
        preferredDates: z.array(z.string().trim().max(20)).max(5).optional(),
        preferredPeriod: z.enum(MEASUREMENT_PERIODS).optional().nullable(),
        clientNotes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
        teamNotes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const open = await prisma.measurementVisit.findFirst({
      where: { projectId: project.id, status: { in: ["REQUESTED", "SCHEDULED"] } },
      select: { id: true },
    });
    if (open) throw new BadRequestError("Já existe uma medição em aberto para este projeto");

    if (input.technicianId) {
      const t = await prisma.user.findFirst({ where: { id: input.technicianId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!t) throw new BadRequestError("Técnico inválido");
    }

    const visit = await prisma.measurementVisit.create({
      data: {
        organizationId: req.user!.organizationId,
        projectId: project.id,
        status: input.scheduledAt ? "SCHEDULED" : "REQUESTED",
        preferredDates: input.preferredDates ?? [],
        preferredPeriod: input.preferredPeriod ?? null,
        clientNotes: nn(input.clientNotes),
        scheduledAt: input.scheduledAt ?? null,
        technicianId: input.technicianId ?? null,
        teamNotes: nn(input.teamNotes),
      },
      include: visitInclude,
    });
    if (visit.technicianId && visit.scheduledAt) {
      await notify(visit.technicianId, "Medição agendada", `${project.code} — ${project.name}: medição em ${visit.scheduledAt.toLocaleDateString("pt-BR")}.`);
    }
    return ok(res, serializeVisit(visit), "Medição criada");
  })
);

// PATCH /api/measurements/:id  -> confirmar data/técnico, notas, cancelar/reabrir
router.patch(
  "/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureVisit(req.params.id, req.user!.organizationId);
    const input = z
      .object({
        scheduledAt: z.coerce.date().optional().nullable(),
        technicianId: z.string().min(1).optional().nullable(),
        teamNotes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
        action: z.enum(["schedule", "cancel", "reopen"]).optional(),
      })
      .parse(req.body);

    if (input.technicianId) {
      const t = await prisma.user.findFirst({ where: { id: input.technicianId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!t) throw new BadRequestError("Técnico inválido");
    }

    const data: Prisma.MeasurementVisitUpdateInput = {
      scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt,
      teamNotes: input.teamNotes === undefined ? undefined : nn(input.teamNotes),
      technician:
        input.technicianId === undefined
          ? undefined
          : input.technicianId
            ? { connect: { id: input.technicianId } }
            : { disconnect: true },
    };
    if (input.action === "cancel") data.status = "CANCELLED";
    if (input.action === "reopen") data.status = "REQUESTED";
    if (input.action === "schedule" || (input.scheduledAt && cur.status === "REQUESTED")) {
      const when = input.scheduledAt ?? cur.scheduledAt;
      if (!when) throw new BadRequestError("Informe a data para agendar");
      data.status = "SCHEDULED";
    }

    const visit = await prisma.measurementVisit.update({ where: { id: cur.id }, data, include: visitInclude });

    const nowScheduled = visit.status === "SCHEDULED" && (cur.status !== "SCHEDULED" || +(cur.scheduledAt ?? 0) !== +(visit.scheduledAt ?? 0));
    if (nowScheduled && visit.technicianId && visit.scheduledAt) {
      await notify(visit.technicianId, "Medição agendada", `${visit.project?.code} — ${visit.project?.name}: medição em ${visit.scheduledAt.toLocaleDateString("pt-BR")}.`);
    }
    if (nowScheduled && visit.scheduledAt) {
      void notifyClientWhatsApp(
        visit.project?.clientId,
        `Sua medição do projeto ${visit.project?.code} foi agendada para ${visit.scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. — MOBIEER`
      );
    }
    return ok(res, serializeVisit(visit), "Medição atualizada");
  })
);

// POST /api/measurements/:id/done  -> conclui e dispara o prazo de 12 dias
router.post(
  "/:id/done",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureVisit(req.params.id, req.user!.organizationId);
    if (cur.status === "DONE") throw new BadRequestError("Medição já concluída");
    if (cur.status === "CANCELLED") throw new BadRequestError("Medição cancelada");
    const input = z.object({ doneAt: z.coerce.date().optional(), teamNotes: z.string().trim().max(2000).optional().nullable().or(z.literal("")) }).parse(req.body);

    const doneAt = input.doneAt ?? new Date();
    const dueAt = techProjectDueDate(doneAt);
    const visit = await prisma.measurementVisit.update({
      where: { id: cur.id },
      data: {
        status: "DONE",
        doneAt,
        techProjectDueAt: dueAt,
        scheduledAt: cur.scheduledAt ?? doneAt,
        teamNotes: input.teamNotes === undefined ? undefined : nn(input.teamNotes),
      },
      include: visitInclude,
    });
    await notify(
      visit.project?.managerId,
      "Medição concluída",
      `${visit.project?.code} — ${visit.project?.name}: medição concluída. Prazo do projeto técnico: ${dueAt.toLocaleDateString("pt-BR")}.`
    );
    return ok(res, serializeVisit(visit), "Medição concluída");
  })
);

export default router;
