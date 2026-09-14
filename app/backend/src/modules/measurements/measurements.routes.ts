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
import { storage, buildStorageKey } from "../../lib/storage";
import { uploadDocument } from "../../middlewares/upload";

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

// ---------------- Anexos e desenho da medição ----------------
// Dois tipos: FILE (foto/documento enviado) e DRAWING (desenho feito à mão no
// tablet — o canvas manda um PNG em dataURL). O desenho pode ser reaberto e
// salvo por cima, então tem PUT.

const attachmentInclude = { createdBy: { select: { id: true, name: true } } } as const;

const serializeAttachment = (a: {
  id: string; visitId: string; kind: string; title: string; fileName: string; mimeType: string;
  sizeBytes: number; notes: string | null; createdAt: Date; updatedAt: Date;
  createdBy: { id: string; name: string } | null;
}) => ({
  id: a.id,
  visitId: a.visitId,
  kind: a.kind,
  title: a.title,
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  notes: a.notes,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  createdBy: a.createdBy,
  downloadUrl: `/api/measurements/attachments/${a.id}/download`,
});

/** PNG em dataURL vindo do canvas do tablet -> Buffer. */
function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new BadRequestError("Desenho inválido (esperado PNG/JPEG em base64)");
  const buffer = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new BadRequestError("Desenho vazio");
  if (buffer.length > 12 * 1024 * 1024) throw new BadRequestError("Desenho muito grande (máx. 12 MB)");
  return { buffer, mimeType: m[1] };
}

// GET /api/measurements/:id/attachments?kind=FILE|DRAWING
router.get(
  "/:id/attachments",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureVisit(req.params.id, req.user!.organizationId);
    const kind = req.query.kind ? String(req.query.kind).toUpperCase() : null;
    if (kind && kind !== "FILE" && kind !== "DRAWING") throw new BadRequestError("Tipo inválido");
    const rows = await prisma.measurementAttachment.findMany({
      where: { visitId: req.params.id, organizationId: req.user!.organizationId, ...(kind ? { kind: kind as never } : {}) },
      include: attachmentInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serializeAttachment));
  })
);

// POST /api/measurements/:id/attachments  (multipart: file + title?, notes?)
router.post(
  "/:id/attachments",
  requirePermission("organization.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const visit = await ensureVisit(req.params.id, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    const input = z
      .object({ title: z.string().trim().max(200).optional().nullable(), notes: z.string().trim().max(2000).optional().nullable() })
      .parse(req.body);

    const key = buildStorageKey(`measurements/${visit.id}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    const row = await prisma.measurementAttachment.create({
      data: {
        organizationId: req.user!.organizationId,
        visitId: visit.id,
        kind: "FILE",
        title: nn(input.title) ?? req.file.originalname,
        storageKey: key,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        notes: nn(input.notes),
        createdById: req.user!.id,
      },
      include: attachmentInclude,
    });
    return ok(res, serializeAttachment(row), "Anexo enviado");
  })
);

// POST /api/measurements/:id/drawings  { dataUrl, title?, notes? }
router.post(
  "/:id/drawings",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const visit = await ensureVisit(req.params.id, req.user!.organizationId);
    const input = z
      .object({
        dataUrl: z.string().min(32),
        title: z.string().trim().max(200).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);

    const { buffer, mimeType } = decodeDataUrl(input.dataUrl);
    const fileName = `desenho-${Date.now()}.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`;
    const key = buildStorageKey(`measurements/${visit.id}`, fileName);
    await storage.put(key, buffer, mimeType);

    const row = await prisma.measurementAttachment.create({
      data: {
        organizationId: req.user!.organizationId,
        visitId: visit.id,
        kind: "DRAWING",
        title: nn(input.title) ?? "Desenho da medição",
        storageKey: key,
        fileName,
        mimeType,
        sizeBytes: buffer.byteLength,
        notes: nn(input.notes),
        createdById: req.user!.id,
      },
      include: attachmentInclude,
    });
    return ok(res, serializeAttachment(row), "Desenho salvo");
  })
);

// PUT /api/measurements/drawings/:attachmentId  { dataUrl, title?, notes? }
// Regravar o desenho por cima (continuar de onde parou no tablet).
router.put(
  "/drawings/:attachmentId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.measurementAttachment.findFirst({
      where: { id: req.params.attachmentId, organizationId: req.user!.organizationId, kind: "DRAWING" },
    });
    if (!cur) throw new NotFoundError("Desenho não encontrado");
    const input = z
      .object({
        dataUrl: z.string().min(32),
        title: z.string().trim().max(200).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);

    const { buffer, mimeType } = decodeDataUrl(input.dataUrl);
    await storage.put(cur.storageKey, buffer, mimeType);
    const row = await prisma.measurementAttachment.update({
      where: { id: cur.id },
      data: {
        mimeType,
        sizeBytes: buffer.byteLength,
        title: input.title === undefined ? undefined : (nn(input.title) ?? cur.title),
        notes: input.notes === undefined ? undefined : nn(input.notes),
      },
      include: attachmentInclude,
    });
    return ok(res, serializeAttachment(row), "Desenho atualizado");
  })
);

// GET /api/measurements/attachments/:attachmentId/download
router.get(
  "/attachments/:attachmentId/download",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const a = await prisma.measurementAttachment.findFirst({
      where: { id: req.params.attachmentId, organizationId: req.user!.organizationId },
    });
    if (!a) throw new NotFoundError("Anexo não encontrado");
    const signed = await storage.getSignedUrl(a.storageKey, a.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(a.storageKey);
    res.setHeader("Content-Type", a.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.fileName)}"`);
    stream.pipe(res);
  })
);

// DELETE /api/measurements/attachments/:attachmentId
router.delete(
  "/attachments/:attachmentId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const a = await prisma.measurementAttachment.findFirst({
      where: { id: req.params.attachmentId, organizationId: req.user!.organizationId },
    });
    if (!a) throw new NotFoundError("Anexo não encontrado");
    await storage.remove(a.storageKey).catch(() => undefined);
    await prisma.measurementAttachment.delete({ where: { id: a.id } });
    return ok(res, { id: a.id }, "Anexo removido");
  })
);

export default router;
