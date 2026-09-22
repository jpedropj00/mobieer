/**
 * Trabalho de campo, lado da equipe: /api/fieldwork
 *
 * - medidas por ambiente com versões (§13)
 * - diário de montagem (§2.3)
 * - avaliação e desempenho do montador (§2.7)
 * - banco de horas do montador (§2.2)
 *
 * O montador usa as rotas equivalentes em /api/me/contractor, que só
 * enxergam as obras atribuídas a ele.
 */
import { Router } from "express";
import { z } from "zod";
import { DiaryAttachmentKind, Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { uploadMedia } from "../../middlewares/upload";
import { assertProjectAccess } from "../../lib/scope";
import { buildStorageKey, storage } from "../../lib/storage";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { dateQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { pipeToResponse } from "../../utils/stream";
import { localPeriod } from "../contractors/contractors.service";
import { hourBank, measureChanged, performanceSummary, ratingAverage, validateRating, validateRoomMeasure } from "./fieldwork.service";

const router = Router();
router.use(authenticate);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const txt = (v: string | null | undefined) => (typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim() || null : (v ?? null));
const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n.toFixed(1)));
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

// ===========================================================================
// Medidas por ambiente
// ===========================================================================

const measureInput = z.object({
  name: z.string().trim().min(1).max(120),
  roomId: z.string().min(1).nullable().optional(),
  widthMm: z.coerce.number().nullable().optional(),
  heightMm: z.coerce.number().nullable().optional(),
  depthMm: z.coerce.number().nullable().optional(),
  ceilingHeightMm: z.coerce.number().nullable().optional(),
  plumbingPoints: z.string().max(4000).nullable().optional(),
  electricalPoints: z.string().max(4000).nullable().optional(),
  interferences: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const serializeMeasure = (m: Prisma.MeasurementRoomGetPayload<{ include: { createdBy: { select: { id: true; name: true } } } }>) => ({
  id: m.id,
  name: m.name,
  roomId: m.roomId,
  version: m.version,
  widthMm: num(m.widthMm),
  heightMm: num(m.heightMm),
  depthMm: num(m.depthMm),
  ceilingHeightMm: num(m.ceilingHeightMm),
  plumbingPoints: m.plumbingPoints,
  electricalPoints: m.electricalPoints,
  interferences: m.interferences,
  notes: m.notes,
  current: m.supersededById === null,
  supersededAt: m.supersededAt,
  createdBy: m.createdBy,
  createdAt: m.createdAt,
});

async function loadMeasurement(measurementId: string, user: { id: string; organizationId: string; permissions: string[] }) {
  const m = await prisma.measurementVisit.findFirst({ where: { id: measurementId, organizationId: user.organizationId }, select: { id: true, projectId: true } });
  if (!m) throw new NotFoundError("Medição não encontrada");
  await assertProjectAccess(m.projectId, user);
  return m;
}

// GET /api/fieldwork/measurements/:id/rooms -> versão atual de cada ambiente
router.get(
  "/measurements/:id/rooms",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await loadMeasurement(req.params.id, req.user!);
    const rows = await prisma.measurementRoom.findMany({
      where: { measurementId: req.params.id, supersededById: null },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok(res, rows.map(serializeMeasure));
  })
);

// POST /api/fieldwork/measurements/:id/rooms
router.post(
  "/measurements/:id/rooms",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const m = await loadMeasurement(req.params.id, req.user!);
    const input = measureInput.parse(req.body);
    validateRoomMeasure(input);
    if (input.roomId) {
      const r = await prisma.projectRoom.findFirst({ where: { id: input.roomId, projectId: m.projectId }, select: { id: true } });
      if (!r) throw new BadRequestError("Ambiente não é deste projeto");
    }
    const row = await prisma.measurementRoom.create({
      data: {
        measurementId: m.id,
        roomId: input.roomId ?? null,
        name: txt(input.name)!,
        widthMm: dec(input.widthMm),
        heightMm: dec(input.heightMm),
        depthMm: dec(input.depthMm),
        ceilingHeightMm: dec(input.ceilingHeightMm),
        plumbingPoints: txt(input.plumbingPoints),
        electricalPoints: txt(input.electricalPoints),
        interferences: txt(input.interferences),
        notes: txt(input.notes),
        createdById: req.user!.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "MEASUREMENT_ROOM_CREATED", entity: "MeasurementVisit", entityId: m.id, details: { room: row.name } } });
    return ok(res, serializeMeasure(row), "Medidas registradas");
  })
);

// PATCH /api/fieldwork/measurement-rooms/:id -> NUNCA sobrescreve: cria a versão seguinte
router.patch(
  "/measurement-rooms/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.measurementRoom.findUnique({ where: { id: req.params.id } });
    if (!cur) throw new NotFoundError("Medida não encontrada");
    const m = await loadMeasurement(cur.measurementId, req.user!);
    if (cur.supersededById) throw new ValidationError("Esta é uma versão antiga. Edite a versão atual.");

    const input = measureInput.partial().extend({ reason: z.string().max(500).optional() }).parse(req.body);
    const next = {
      name: input.name ?? cur.name,
      widthMm: input.widthMm === undefined ? num(cur.widthMm) : input.widthMm,
      heightMm: input.heightMm === undefined ? num(cur.heightMm) : input.heightMm,
      depthMm: input.depthMm === undefined ? num(cur.depthMm) : input.depthMm,
      ceilingHeightMm: input.ceilingHeightMm === undefined ? num(cur.ceilingHeightMm) : input.ceilingHeightMm,
      plumbingPoints: input.plumbingPoints === undefined ? cur.plumbingPoints : txt(input.plumbingPoints),
      electricalPoints: input.electricalPoints === undefined ? cur.electricalPoints : txt(input.electricalPoints),
      interferences: input.interferences === undefined ? cur.interferences : txt(input.interferences),
      notes: input.notes === undefined ? cur.notes : txt(input.notes),
    };
    validateRoomMeasure(next);
    const changed = measureChanged({ ...cur, widthMm: num(cur.widthMm), heightMm: num(cur.heightMm), depthMm: num(cur.depthMm), ceilingHeightMm: num(cur.ceilingHeightMm) }, next);
    if (!changed.length) return ok(res, null, "Nada mudou");

    const created = await prisma.$transaction(async (tx) => {
      const nova = await tx.measurementRoom.create({
        data: {
          measurementId: m.id,
          roomId: cur.roomId,
          version: cur.version + 1,
          name: next.name,
          widthMm: dec(next.widthMm),
          heightMm: dec(next.heightMm),
          depthMm: dec(next.depthMm),
          ceilingHeightMm: dec(next.ceilingHeightMm),
          plumbingPoints: next.plumbingPoints,
          electricalPoints: next.electricalPoints,
          interferences: next.interferences,
          notes: next.notes,
          createdById: req.user!.id,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      await tx.measurementRoom.update({ where: { id: cur.id }, data: { supersededById: nova.id, supersededAt: new Date() } });
      await tx.auditLog.create({
        data: { userId: req.user!.id, action: "MEASUREMENT_ROOM_VERSIONED", entity: "MeasurementVisit", entityId: m.id, details: { room: cur.name, from: cur.version, to: nova.version, changed, reason: input.reason ?? null } },
      });
      return nova;
    });
    return ok(res, serializeMeasure(created), `Versão ${created.version} das medidas registrada`);
  })
);

// GET /api/fieldwork/measurement-rooms/:id/history -> todas as versões daquele ambiente
router.get(
  "/measurement-rooms/:id/history",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const withAuthor = { createdBy: { select: { id: true, name: true } } } as const;
    type Row = Prisma.MeasurementRoomGetPayload<{ include: typeof withAuthor }>;
    const first: Row | null = await prisma.measurementRoom.findUnique({ where: { id: req.params.id }, include: withAuthor });
    if (!first) throw new NotFoundError("Medida não encontrada");
    await loadMeasurement(first.measurementId, req.user!);
    // anda para trás pela cadeia de versões
    const chain: Row[] = [first];
    let cur: Row = first;
    for (let i = 0; i < 100; i++) {
      const prev: Row | null = await prisma.measurementRoom.findUnique({ where: { supersededById: cur.id }, include: withAuthor });
      if (!prev) break;
      chain.push(prev);
      cur = prev;
    }
    return ok(res, chain.map(serializeMeasure));
  })
);

// ===========================================================================
// Diário de montagem
// ===========================================================================

export const diaryInput = z.object({
  description: z.string().trim().min(3, "Descreva o andamento").max(5000),
  progressPct: z.coerce.number().int().min(0).max(100).nullable().optional(),
  problems: z.string().max(4000).nullable().optional(),
  materialsUsed: z.string().max(4000).nullable().optional(),
  missingParts: z.string().max(4000).nullable().optional(),
  roomId: z.string().min(1).nullable().optional(),
  contractorId: z.string().min(1).nullable().optional(),
});

export const diaryInclude = {
  author: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  attachments: { orderBy: { createdAt: "asc" as const }, select: { id: true, kind: true, fileName: true, mimeType: true, size: true } },
} satisfies Prisma.InstallationDiaryEntryInclude;

const kindOf = (mime: string): DiaryAttachmentKind =>
  mime.startsWith("image/") ? DiaryAttachmentKind.FOTO : mime.startsWith("video/") ? DiaryAttachmentKind.VIDEO : DiaryAttachmentKind.DOCUMENTO;

/** Grava a entrada e os arquivos. Se algo falhar, apaga o que já subiu. */
export async function createDiaryEntry(opts: {
  organizationId: string;
  projectId: string;
  authorId: string;
  contractorId: string | null;
  input: z.infer<typeof diaryInput>;
  files: Express.Multer.File[];
}) {
  if (opts.input.roomId) {
    const r = await prisma.projectRoom.findFirst({ where: { id: opts.input.roomId, projectId: opts.projectId }, select: { id: true } });
    if (!r) throw new BadRequestError("Ambiente não é deste projeto");
  }
  const uploaded: { key: string; file: Express.Multer.File }[] = [];
  try {
    for (const f of opts.files) {
      const key = buildStorageKey(`projects/${opts.projectId}/diary`, f.originalname);
      await storage.put(key, f.buffer, f.mimetype);
      uploaded.push({ key, file: f });
    }
    return await prisma.installationDiaryEntry.create({
      data: {
        organizationId: opts.organizationId,
        projectId: opts.projectId,
        contractorId: opts.contractorId,
        roomId: opts.input.roomId ?? null,
        authorId: opts.authorId,
        progressPct: opts.input.progressPct ?? null,
        description: txt(opts.input.description)!,
        problems: txt(opts.input.problems),
        materialsUsed: txt(opts.input.materialsUsed),
        missingParts: txt(opts.input.missingParts),
        attachments: {
          create: uploaded.map((u) => ({ kind: kindOf(u.file.mimetype), storageKey: u.key, fileName: u.file.originalname, mimeType: u.file.mimetype, size: u.file.size })),
        },
      },
      include: diaryInclude,
    });
  } catch (e) {
    for (const u of uploaded) await storage.remove(u.key).catch(() => undefined);
    throw e;
  }
}

// GET /api/fieldwork/projects/:projectId/diary
router.get(
  "/projects/:projectId/diary",
  requirePermission("timeline.read"),
  asyncHandler(async (req, res) => {
    await assertProjectAccess(req.params.projectId, req.user!);
    const rows = await prisma.installationDiaryEntry.findMany({ where: { projectId: req.params.projectId }, include: diaryInclude, orderBy: { createdAt: "desc" }, take: 200 });
    return ok(res, rows);
  })
);

// POST /api/fieldwork/projects/:projectId/diary (multipart: campos + files[])
router.post(
  "/projects/:projectId/diary",
  requirePermission("timeline.edit"),
  uploadMedia.array("files", 10),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    await assertProjectAccess(projectId, req.user!);
    const input = diaryInput.parse(req.body);
    if (input.contractorId) {
      const c = await prisma.contractor.findFirst({ where: { id: input.contractorId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!c) throw new BadRequestError("Montador inválido");
    }
    const entry = await createDiaryEntry({
      organizationId: req.user!.organizationId,
      projectId,
      authorId: req.user!.id,
      contractorId: input.contractorId ?? null,
      input,
      files: (req.files as Express.Multer.File[]) ?? [],
    });
    return ok(res, entry, "Registro adicionado ao diário");
  })
);

// GET /api/fieldwork/diary-attachments/:id -> arquivo, conferindo o escopo do projeto
router.get(
  "/diary-attachments/:id",
  requireAnyPermission(["timeline.read", "contractors.self"]),
  asyncHandler(async (req, res) => {
    const a = await prisma.installationDiaryAttachment.findUnique({
      where: { id: req.params.id },
      include: { entry: { select: { projectId: true, organizationId: true } } },
    });
    if (!a || a.entry.organizationId !== req.user!.organizationId) throw new NotFoundError("Arquivo não encontrado");
    await assertProjectAccess(a.entry.projectId, req.user!);
    const signed = await storage.getSignedUrl(a.storageKey, a.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(a.storageKey);
    res.setHeader("Content-Type", a.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(a.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

// ===========================================================================
// Avaliação e desempenho do montador
// ===========================================================================

const ratingInput = z.object({
  contractorId: z.string().min(1),
  quality: z.coerce.number().int(),
  deadline: z.coerce.number().int(),
  organizationScore: z.coerce.number().int(),
  finish: z.coerce.number().int(),
  service: z.coerce.number().int(),
  rework: z.boolean().default(false),
  reworkNotes: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

// POST /api/fieldwork/projects/:projectId/ratings -> uma por montador por projeto (reavaliar atualiza)
router.post(
  "/projects/:projectId/ratings",
  requirePermission("contractors.manage"),
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    await assertProjectAccess(projectId, req.user!);
    const input = ratingInput.parse(req.body);
    validateRating(input);
    // só avalia quem trabalhou na obra
    const worked = await prisma.contractor.findFirst({
      where: {
        id: input.contractorId,
        organizationId: req.user!.organizationId,
        OR: [{ installationTasks: { some: { projectId } } }, { shifts: { some: { projectId } } }],
      },
      select: { id: true, name: true },
    });
    if (!worked) throw new ValidationError("Este montador não trabalhou nesta obra");

    const data = {
      quality: input.quality,
      deadline: input.deadline,
      organizationScore: input.organizationScore,
      finish: input.finish,
      service: input.service,
      rework: input.rework,
      reworkNotes: input.rework ? txt(input.reworkNotes) : null,
      notes: txt(input.notes),
      ratedById: req.user!.id,
    };
    const rating = await prisma.contractorRating.upsert({
      where: { projectId_contractorId: { projectId, contractorId: worked.id } },
      create: { organizationId: req.user!.organizationId, projectId, contractorId: worked.id, ...data },
      update: data,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CONTRACTOR_RATED", entity: "Contractor", entityId: worked.id, details: { projectId, average: ratingAverage(input), rework: input.rework } } });
    return ok(res, { ...rating, average: ratingAverage(rating) }, `Avaliação de ${worked.name} registrada`);
  })
);

// GET /api/fieldwork/projects/:projectId/ratings
router.get(
  "/projects/:projectId/ratings",
  requireAnyPermission(["contractors.manage", "hr.read"]),
  asyncHandler(async (req, res) => {
    await assertProjectAccess(req.params.projectId, req.user!);
    const rows = await prisma.contractorRating.findMany({
      where: { projectId: req.params.projectId },
      include: { contractor: { select: { id: true, name: true } }, ratedBy: { select: { name: true } } },
    });
    return ok(res, rows.map((r) => ({ ...r, average: ratingAverage(r) })));
  })
);

// GET /api/fieldwork/contractors/:id/performance -> histórico de desempenho
router.get(
  "/contractors/:id/performance",
  requireAnyPermission(["contractors.manage", "hr.read"]),
  asyncHandler(async (req, res) => {
    const c = await prisma.contractor.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true, name: true } });
    if (!c) throw new NotFoundError("Montador não encontrado");
    const rows = await prisma.contractorRating.findMany({
      where: { contractorId: c.id },
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, {
      contractor: c,
      summary: performanceSummary(rows),
      history: rows.map((r) => ({ id: r.id, project: r.project, average: ratingAverage(r), rework: r.rework, notes: r.notes, createdAt: r.createdAt })),
    });
  })
);

// GET /api/fieldwork/contractors/:id/hour-bank?from&to
router.get(
  "/contractors/:id/hour-bank",
  requireAnyPermission(["contractors.manage", "hr.read"]),
  asyncHandler(async (req, res) => {
    const c = await prisma.contractor.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true, name: true, expectedDailyMinutes: true } });
    if (!c) throw new NotFoundError("Montador não encontrado");
    const { from, to } = localPeriod(dateQuery(req.query.from, "início"), dateQuery(req.query.to, "fim"), 30);
    const shifts = await prisma.contractorShift.findMany({ where: { contractorId: c.id, checkInAt: { gte: from, lt: to } }, select: { checkInAt: true, checkOutAt: true } });
    return ok(res, { contractor: c, period: { from, to }, ...hourBank(shifts, c.expectedDailyMinutes) });
  })
);

// GET /api/fieldwork/projects/:projectId/contractors -> quem trabalhou nesta obra
router.get(
  "/projects/:projectId/contractors",
  requireAnyPermission(["contractors.manage", "hr.read", "timeline.read"]),
  asyncHandler(async (req, res) => {
    await assertProjectAccess(req.params.projectId, req.user!);
    const rows = await prisma.contractor.findMany({
      where: {
        organizationId: req.user!.organizationId,
        OR: [{ installationTasks: { some: { projectId: req.params.projectId } } }, { shifts: { some: { projectId: req.params.projectId } } }],
      },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    });
    return ok(res, rows);
  })
);

export default router;
