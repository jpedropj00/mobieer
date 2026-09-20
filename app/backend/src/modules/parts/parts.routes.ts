/**
 * Solicitação de peças: /api/parts
 *
 * O montador externo pede peças da obra (com fotos, medidas e ambiente), a
 * equipe analisa, produz, entrega e conclui. Fluxo de 12 status com histórico
 * imutável — quem não é admin não apaga nem edita o que já aconteceu.
 *
 * Separado da Requisition do almoxarifado de propósito: aquela movimenta
 * estoque e tem outras etapas. Quando a solicitação é aprovada, dá para gerar
 * uma atividade de montagem a partir dela.
 */
import { Router } from "express";
import { z } from "zod";
import { PartRequestPhotoKind, PartRequestStatus, Prisma, RequisitionPriority, RoomType, Unit } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requireAnyPermission, requirePermission } from "../../middlewares/rbac";
import { uploadPhoto } from "../../middlewares/upload";
import { buildStorageKey, storage } from "../../lib/storage";
import { notifyUser, notifyUsersWithPermission } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { enumQuery, intQuery, queryString } from "../../utils/query";
import { ok } from "../../utils/response";
import { pipeToResponse } from "../../utils/stream";
import {
  ALLOWED_TRANSITIONS,
  PART_STATUSES,
  STATUS_LABEL,
  type Actor,
  assertCanEdit,
  assertCanSee,
  assertOcrConfirmed,
  assertSubmittable,
  assertTransition,
  formatNumber,
  isFinal,
  timestampsFor,
  validateItem,
} from "./parts.service";

const router = Router();
router.use(authenticate);

const canRead = requirePermission("parts.read");
const canCreate = requirePermission("parts.create");

const MAX_PHOTOS = 12;
const MAX_ITEMS = 50;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n.toFixed(2)));
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const txt = <T extends string | null | undefined>(v: T) => (typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim() || null : (v ?? null));
const str = (max: number) => z.string().trim().max(max);

/** Quem está agindo, com o vínculo de montador resolvido. */
async function actorOf(req: { user?: { id: string; permissions: string[] } }): Promise<Actor & { contractorId: string | null }> {
  const u = req.user!;
  const contractor = await prisma.contractor.findUnique({ where: { userId: u.id }, select: { id: true, active: true } });
  // montador desativado perde o acesso às próprias solicitações também
  return { id: u.id, permissions: u.permissions, contractorId: contractor?.active ? contractor.id : null };
}

const include = {
  contractor: { select: { id: true, name: true, phone: true, active: true, userId: true } },
  project: { select: { id: true, code: true, name: true } },
  activity: { select: { id: true, number: true, service: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  analyst: { select: { id: true, name: true } },
  items: { orderBy: { createdAt: "asc" as const } },
  photos: {
    orderBy: { createdAt: "asc" as const },
    include: { uploadedBy: { select: { id: true, name: true } }, ocrConfirmedBy: { select: { id: true, name: true } } },
  },
  history: {
    orderBy: { createdAt: "desc" as const },
    include: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PartRequestInclude;

type FullRequest = Prisma.PartRequestGetPayload<{ include: typeof include }>;

function serialize(r: FullRequest, actor: Actor) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    priority: r.priority,
    title: r.title,
    roomType: r.roomType,
    roomLabel: r.roomLabel,
    neededAt: r.neededAt,
    notes: r.notes,
    refusalReason: r.refusalReason,
    contractor: r.contractor,
    project: r.project,
    activity: r.activity,
    createdBy: r.createdBy,
    analyst: r.analyst,
    submittedAt: r.submittedAt,
    analyzedAt: r.analyzedAt,
    approvedAt: r.approvedAt,
    refusedAt: r.refusedAt,
    deliveredAt: r.deliveredAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    itemCount: r.items.length,
    totalQuantity: r.items.reduce((s, i) => s + i.quantity, 0),
    isFinal: isFinal(r.status),
    // a tela só mostra os botões que esta pessoa consegue usar de fato
    nextStatuses: isFinal(r.status)
      ? []
      : ALLOWED_TRANSITIONS[r.status]
          .filter((s) => {
            try {
              assertTransition(r.status, s, actor, { refusalReason: "x" });
              return true;
            } catch {
              return false;
            }
          })
          .map((s) => ({ status: s, label: STATUS_LABEL[s] })),
    items: r.items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      description: i.description,
      quantity: i.quantity,
      width: num(i.width),
      height: num(i.height),
      depth: num(i.depth),
      thickness: num(i.thickness),
      unit: i.unit,
      finish: i.finish,
      color: i.color,
      material: i.material,
      notes: i.notes,
    })),
    photos: r.photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      fileName: p.fileName,
      mimeType: p.mimeType,
      size: p.size,
      caption: p.caption,
      hasOcr: Boolean(p.ocrJson),
      ocrText: p.ocrText,
      ocrSuggestion: p.ocrJson ?? null,
      ocrConfirmedAt: p.ocrConfirmedAt,
      ocrConfirmedBy: p.ocrConfirmedBy,
      uploadedBy: p.uploadedBy,
      createdAt: p.createdAt,
    })),
    history: r.history.map((h) => ({
      id: h.id,
      user: h.user,
      fromStatus: h.fromStatus,
      fromLabel: h.fromStatus ? STATUS_LABEL[h.fromStatus] : null,
      toStatus: h.toStatus,
      toLabel: STATUS_LABEL[h.toStatus],
      note: h.note,
      createdAt: h.createdAt,
    })),
  };
}

const itemInput = z.object({
  name: str(160).min(1, "Informe o nome da peça"),
  code: str(80).optional().nullable(),
  description: str(2000).optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(9999).default(1),
  width: z.coerce.number().optional().nullable(),
  height: z.coerce.number().optional().nullable(),
  depth: z.coerce.number().optional().nullable(),
  thickness: z.coerce.number().optional().nullable(),
  unit: z.nativeEnum(Unit).default(Unit.UNIT),
  finish: str(120).optional().nullable(),
  color: str(80).optional().nullable(),
  material: str(120).optional().nullable(),
  notes: str(2000).optional().nullable(),
});

const requestInput = z.object({
  title: str(180).min(1, "Descreva em poucas palavras o que você precisa"),
  roomType: z.nativeEnum(RoomType).optional().nullable(),
  roomLabel: str(120).optional().nullable(),
  priority: z.nativeEnum(RequisitionPriority).default(RequisitionPriority.NORMAL),
  neededAt: z.coerce.date().optional().nullable(),
  notes: str(4000).optional().nullable(),
  projectId: z.string().min(1).optional().nullable(),
  activityId: z.string().min(1).optional().nullable(),
  contractorId: z.string().min(1).optional().nullable(),
  items: z.array(itemInput).max(MAX_ITEMS).optional(),
});

const itemData = (i: z.infer<typeof itemInput>) => ({
  name: txt(i.name)!,
  code: txt(i.code),
  description: txt(i.description),
  quantity: i.quantity,
  width: dec(i.width),
  height: dec(i.height),
  depth: dec(i.depth),
  thickness: dec(i.thickness),
  unit: i.unit,
  finish: txt(i.finish),
  color: txt(i.color),
  material: txt(i.material),
  notes: txt(i.notes),
});

async function validateLinks(input: { projectId?: string | null; activityId?: string | null; contractorId?: string | null }, organizationId: string) {
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId }, select: { id: true } });
    if (!p) throw new BadRequestError("Projeto inválido");
  }
  if (input.activityId) {
    const a = await prisma.activity.findFirst({ where: { id: input.activityId, organizationId }, select: { id: true } });
    if (!a) throw new BadRequestError("Atividade inválida");
  }
  if (input.contractorId) {
    const c = await prisma.contractor.findFirst({ where: { id: input.contractorId, organizationId }, select: { id: true, active: true } });
    if (!c) throw new BadRequestError("Montador inválido");
    if (!c.active) throw new ValidationError("Este montador está desativado");
  }
}

/** Próximo número da organização, dentro da transação para não repetir. */
async function nextNumber(tx: Prisma.TransactionClient) {
  const last = await tx.partRequest.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? Number(last.number.replace(/\D/g, "")) + 1 : 1;
  return formatNumber(n);
}

async function loadFor(id: string, organizationId: string, actor: Actor & { contractorId: string | null }) {
  const r = await prisma.partRequest.findFirst({ where: { id, organizationId }, include });
  if (!r) throw new NotFoundError("Solicitação não encontrada");
  assertCanSee(r, actor);
  return r;
}

// ===========================================================================
// Listagem e opções
// ===========================================================================

router.get(
  "/options",
  canRead,
  asyncHandler(async (_req, res) =>
    ok(res, {
      statuses: PART_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
      priorities: Object.values(RequisitionPriority),
      roomTypes: Object.values(RoomType),
      units: Object.values(Unit),
      photoKinds: Object.values(PartRequestPhotoKind),
      maxPhotos: MAX_PHOTOS,
      maxItems: MAX_ITEMS,
    })
  )
);

// GET /api/parts — lista, respeitando o que cada um pode ver
router.get(
  "/",
  canRead,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const where: Prisma.PartRequestWhereInput = { organizationId: req.user!.organizationId };

    const status = enumQuery(req.query.status, PartRequestStatus, "status");
    if (status) where.status = status;
    const priority = enumQuery(req.query.priority, RequisitionPriority, "prioridade");
    if (priority) where.priority = priority;
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    if (req.query.activityId) where.activityId = String(req.query.activityId);
    if (req.query.contractorId) where.contractorId = String(req.query.contractorId);
    if (req.query.open === "true") where.status = { notIn: [PartRequestStatus.CONCLUIDA, PartRequestStatus.RECUSADA, PartRequestStatus.CANCELADA] };

    const q = queryString(req.query.q);
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { roomLabel: { contains: q, mode: "insensitive" } },
        { items: { some: { name: { contains: q, mode: "insensitive" } } } },
        { items: { some: { code: { contains: q, mode: "insensitive" } } } },
      ];
    }

    // sem parts.read.all, só o que é seu
    if (!actor.permissions.includes("parts.read.all")) {
      where.AND = [{ OR: [{ createdById: actor.id }, ...(actor.contractorId ? [{ contractorId: actor.contractorId }] : [])] }];
    }

    const rows = await prisma.partRequest.findMany({
      where,
      include,
      orderBy: [{ neededAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: intQuery(req.query.limit, { min: 1, max: 300, name: "limit" }) ?? 100,
    });
    return ok(res, rows.map((r) => serialize(r, actor)));
  })
);

// GET /api/parts/summary — contagem por status, para o quadro
router.get(
  "/summary",
  canRead,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const where: Prisma.PartRequestWhereInput = { organizationId: req.user!.organizationId };
    if (!actor.permissions.includes("parts.read.all")) {
      where.OR = [{ createdById: actor.id }, ...(actor.contractorId ? [{ contractorId: actor.contractorId }] : [])];
    }
    const rows = await prisma.partRequest.groupBy({ by: ["status"], where, _count: { _all: true } });
    const counts = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    return ok(res, {
      byStatus: PART_STATUSES.map((s) => ({ status: s, label: STATUS_LABEL[s], count: counts[s] ?? 0 })),
      total: rows.reduce((s, r) => s + r._count._all, 0),
      open: PART_STATUSES.filter((s) => !isFinal(s)).reduce((s, st) => s + (counts[st] ?? 0), 0),
    });
  })
);

// ===========================================================================
// Criação e edição
// ===========================================================================

router.post(
  "/",
  canCreate,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const input = requestInput.parse(req.body);
    const organizationId = req.user!.organizationId;

    // montador cria para si; a equipe pode apontar o montador
    const contractorId = input.contractorId ?? actor.contractorId ?? null;
    await validateLinks({ ...input, contractorId }, organizationId);
    (input.items ?? []).forEach(validateItem);

    const created = await prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx);
      const r = await tx.partRequest.create({
        data: {
          organizationId,
          number,
          title: txt(input.title)!,
          roomType: input.roomType ?? null,
          roomLabel: txt(input.roomLabel),
          priority: input.priority,
          neededAt: input.neededAt ?? null,
          notes: txt(input.notes),
          projectId: input.projectId ?? null,
          activityId: input.activityId ?? null,
          contractorId,
          createdById: actor.id,
          items: { create: (input.items ?? []).map(itemData) },
          history: { create: { userId: actor.id, toStatus: PartRequestStatus.RASCUNHO, note: "Solicitação criada" } },
        },
        include,
      });
      return r;
    });

    return ok(res, serialize(created, actor), `Solicitação ${created.number} criada`);
  })
);

router.get(
  "/:id",
  canRead,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const r = await loadFor(req.params.id, req.user!.organizationId, actor);
    return ok(res, serialize(r, actor));
  })
);

router.patch(
  "/:id",
  requireAnyPermission(["parts.create", "parts.analyze"]),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const current = await loadFor(req.params.id, req.user!.organizationId, actor);
    assertCanEdit(current, actor);

    const input = requestInput.partial().parse(req.body);
    await validateLinks(input, req.user!.organizationId);

    const updated = await prisma.$transaction(async (tx) => {
      // a lista de peças, quando vem, substitui a anterior por inteiro
      if (input.items) {
        input.items.forEach(validateItem);
        await tx.partRequestItem.deleteMany({ where: { partRequestId: current.id } });
        if (input.items.length) {
          await tx.partRequestItem.createMany({ data: input.items.map((i) => ({ ...itemData(i), partRequestId: current.id })) });
        }
      }
      await tx.partRequest.update({
        where: { id: current.id },
        data: {
          title: input.title === undefined ? undefined : txt(input.title)!,
          roomType: input.roomType === undefined ? undefined : input.roomType,
          roomLabel: input.roomLabel === undefined ? undefined : txt(input.roomLabel),
          priority: input.priority,
          neededAt: input.neededAt === undefined ? undefined : input.neededAt,
          notes: input.notes === undefined ? undefined : txt(input.notes),
          projectId: input.projectId === undefined ? undefined : input.projectId,
          activityId: input.activityId === undefined ? undefined : input.activityId,
          contractorId: input.contractorId === undefined ? undefined : input.contractorId,
        },
      });
      return tx.partRequest.findUniqueOrThrow({ where: { id: current.id }, include });
    });

    return ok(res, serialize(updated, actor), "Solicitação atualizada");
  })
);

// DELETE — só rascunho, e só de quem criou
router.delete(
  "/:id",
  canCreate,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const current = await loadFor(req.params.id, req.user!.organizationId, actor);
    if (current.status !== PartRequestStatus.RASCUNHO) {
      throw new ValidationError("Só rascunho pode ser excluído. Depois de enviada, cancele para manter o histórico.");
    }
    if (current.createdById !== actor.id && !actor.permissions.includes("parts.analyze")) {
      throw new ForbiddenError("Só quem criou o rascunho pode excluí-lo");
    }
    const fotos = await prisma.partRequestPhoto.findMany({ where: { partRequestId: current.id }, select: { storageKey: true } });
    await prisma.partRequest.delete({ where: { id: current.id } });
    for (const f of fotos) await storage.remove(f.storageKey).catch(() => undefined);
    return ok(res, { id: current.id }, "Rascunho excluído");
  })
);

// ===========================================================================
// Fluxo de status
// ===========================================================================

router.post(
  "/:id/status",
  canRead,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const current = await loadFor(req.params.id, req.user!.organizationId, actor);
    const input = z
      .object({
        status: z.nativeEnum(PartRequestStatus),
        note: str(1000).optional().nullable(),
        refusalReason: str(1000).optional().nullable(),
      })
      .parse(req.body);

    assertTransition(current.status, input.status, actor, { refusalReason: input.refusalReason });
    if (input.status === PartRequestStatus.ENVIADA) assertSubmittable(current.items.length);

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.partRequest.update({
        where: { id: current.id },
        data: {
          status: input.status,
          ...timestampsFor(input.status, now),
          ...(input.status === PartRequestStatus.RECUSADA ? { refusalReason: txt(input.refusalReason) } : {}),
          ...(input.status === PartRequestStatus.EM_ANALISE || input.status === PartRequestStatus.APROVADA || input.status === PartRequestStatus.RECUSADA
            ? { analystId: actor.id }
            : {}),
        },
      });
      await tx.partRequestHistory.create({
        data: {
          partRequestId: current.id,
          userId: actor.id,
          fromStatus: current.status,
          toStatus: input.status,
          note: txt(input.refusalReason ?? input.note),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "PART_REQUEST_STATUS_CHANGED",
          entity: "PartRequest",
          entityId: current.id,
          details: { from: current.status, to: input.status, note: input.note ?? null },
        },
      });
      return tx.partRequest.findUniqueOrThrow({ where: { id: current.id }, include });
    });

    // quem pediu a peça precisa saber que ela andou
    const destinatario = updated.contractor?.userId ?? updated.createdById;
    if (destinatario && destinatario !== actor.id) {
      await notifyUser(
        destinatario,
        `Solicitação ${updated.number}: ${STATUS_LABEL[input.status]}`,
        input.status === PartRequestStatus.RECUSADA ? `Motivo: ${updated.refusalReason}` : updated.title
      );
    }
    if (input.status === PartRequestStatus.ENVIADA) {
      await notifyUsersWithPermission({
        organizationId: req.user!.organizationId,
        permission: "parts.analyze",
        title: `Nova solicitação de peças ${updated.number}`,
        message: `${updated.title}${updated.roomLabel ? ` · ${updated.roomLabel}` : ""}`,
        excludeUserId: actor.id,
      });
    }

    return ok(res, serialize(updated, actor), `Solicitação ${STATUS_LABEL[input.status].toLowerCase()}`);
  })
);

// POST /api/parts/:id/activity — gera a atividade de montagem da solicitação aprovada
router.post(
  "/:id/activity",
  requireAnyPermission(["parts.analyze", "activities.create"]),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const current = await loadFor(req.params.id, req.user!.organizationId, actor);
    if (current.activityId) throw new ValidationError("Esta solicitação já tem atividade vinculada");
    if (current.status === PartRequestStatus.RASCUNHO || isFinal(current.status)) {
      throw new ValidationError("Gere a atividade a partir de uma solicitação em andamento");
    }

    const input = z.object({ date: z.coerce.date().optional(), employeeId: z.string().min(1).optional() }).parse(req.body ?? {});
    const employeeId = input.employeeId ?? current.contractor?.userId ?? actor.id;
    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!employee) throw new BadRequestError("Responsável inválido");

    const activity = await prisma.$transaction(async (tx) => {
      const last = await tx.activity.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
      const number = `ATV-${String((last ? Number(last.number.replace(/\D/g, "")) : 0) + 1).padStart(5, "0")}`;
      const a = await tx.activity.create({
        data: {
          organizationId: req.user!.organizationId,
          number,
          date: input.date ?? current.neededAt ?? new Date(),
          service: `Montagem de peças · ${current.number}`,
          description: [current.title, current.roomLabel, current.notes].filter(Boolean).join("\n"),
          sector: "Montagem",
          projectReference: current.project?.code ?? null,
          employeeId: employee.id,
          createdById: actor.id,
          history: { create: { userId: actor.id, action: "CREATED" } },
        },
        select: { id: true, number: true, service: true, status: true },
      });
      await tx.partRequest.update({ where: { id: current.id }, data: { activityId: a.id } });
      return a;
    });

    return ok(res, activity, `Atividade ${activity.number} criada a partir da solicitação`);
  })
);

// ===========================================================================
// Fotos
// ===========================================================================

router.post(
  "/:id/photos",
  requireAnyPermission(["parts.create", "parts.analyze"]),
  uploadPhoto.single("photo"),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const current = await loadFor(req.params.id, req.user!.organizationId, actor);
    if (isFinal(current.status)) throw new ValidationError("Solicitação encerrada não recebe mais fotos");
    if (!req.file) throw new ValidationError("Envie uma foto");
    if (current.photos.length >= MAX_PHOTOS) throw new ValidationError(`Máximo de ${MAX_PHOTOS} fotos por solicitação`);

    const input = z
      .object({ kind: z.nativeEnum(PartRequestPhotoKind).default(PartRequestPhotoKind.PECA), caption: str(300).optional().nullable() })
      .parse(req.body ?? {});

    const key = buildStorageKey(`parts/${current.id}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    try {
      const p = await prisma.partRequestPhoto.create({
        data: {
          partRequestId: current.id,
          kind: input.kind,
          storageKey: key,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          caption: txt(input.caption),
          uploadedById: actor.id,
        },
        include: { uploadedBy: { select: { id: true, name: true } } },
      });
      return ok(res, { id: p.id, kind: p.kind, fileName: p.fileName, caption: p.caption, uploadedBy: p.uploadedBy, createdAt: p.createdAt }, "Foto anexada");
    } catch (e) {
      await storage.remove(key).catch(() => undefined);
      throw e;
    }
  })
);

router.get(
  "/photos/:photoId/file",
  canRead,
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const p = await prisma.partRequestPhoto.findFirst({
      where: { id: req.params.photoId, partRequest: { organizationId: req.user!.organizationId } },
      include: { partRequest: { select: { createdById: true, contractorId: true } } },
    });
    if (!p) throw new NotFoundError("Foto não encontrada");
    assertCanSee(p.partRequest, actor);

    const signed = await storage.getSignedUrl(p.storageKey, p.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(p.storageKey);
    res.setHeader("Content-Type", p.mimeType ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(p.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

router.delete(
  "/photos/:photoId",
  requireAnyPermission(["parts.create", "parts.analyze"]),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const p = await prisma.partRequestPhoto.findFirst({
      where: { id: req.params.photoId, partRequest: { organizationId: req.user!.organizationId } },
      include: { partRequest: { select: { status: true, createdById: true, contractorId: true } } },
    });
    if (!p) throw new NotFoundError("Foto não encontrada");
    assertCanSee(p.partRequest, actor);
    if (isFinal(p.partRequest.status)) throw new ValidationError("Solicitação encerrada: as fotos ficam no histórico");

    await prisma.partRequestPhoto.delete({ where: { id: p.id } });
    await storage.remove(p.storageKey).catch(() => undefined);
    return ok(res, { id: p.id }, "Foto removida");
  })
);

/**
 * Leitura da etiqueta (OCR/IA). A estrutura está pronta: a extração grava
 * ocrText/ocrJson, e a peça só é preenchida depois que alguém confirma.
 * Enquanto não há provedor configurado, a sugestão entra pela conferência
 * manual — a confirmação humana é a mesma nos dois casos.
 */
router.post(
  "/photos/:photoId/ocr",
  requireAnyPermission(["parts.create", "parts.analyze"]),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const p = await prisma.partRequestPhoto.findFirst({
      where: { id: req.params.photoId, partRequest: { organizationId: req.user!.organizationId } },
      include: { partRequest: { select: { createdById: true, contractorId: true, status: true } } },
    });
    if (!p) throw new NotFoundError("Foto não encontrada");
    assertCanSee(p.partRequest, actor);

    const input = z
      .object({
        ocrText: str(4000).optional().nullable(),
        suggestion: z
          .object({
            code: str(80).optional().nullable(),
            name: str(160).optional().nullable(),
            width: z.coerce.number().positive().max(10000).optional().nullable(),
            height: z.coerce.number().positive().max(10000).optional().nullable(),
            depth: z.coerce.number().positive().max(10000).optional().nullable(),
            thickness: z.coerce.number().positive().max(10000).optional().nullable(),
          })
          .optional(),
      })
      .parse(req.body ?? {});

    const updated = await prisma.partRequestPhoto.update({
      where: { id: p.id },
      data: {
        ocrText: txt(input.ocrText),
        ocrJson: (input.suggestion ?? {}) as Prisma.InputJsonValue,
        // nova leitura zera a confirmação anterior
        ocrConfirmedAt: null,
        ocrConfirmedById: null,
      },
      select: { id: true, ocrText: true, ocrJson: true },
    });
    return ok(res, updated, "Leitura registrada. Confirme antes de usar na peça.");
  })
);

// POST /api/parts/photos/:photoId/ocr/confirm — confirma e opcionalmente cria a peça
router.post(
  "/photos/:photoId/ocr/confirm",
  requireAnyPermission(["parts.create", "parts.analyze"]),
  asyncHandler(async (req, res) => {
    const actor = await actorOf(req);
    const p = await prisma.partRequestPhoto.findFirst({
      where: { id: req.params.photoId, partRequest: { organizationId: req.user!.organizationId } },
      include: { partRequest: { select: { id: true, status: true, createdById: true, contractorId: true, _count: { select: { items: true } } } } },
    });
    if (!p) throw new NotFoundError("Foto não encontrada");
    assertCanSee(p.partRequest, actor);
    assertCanEdit(p.partRequest, actor);
    if (!p.ocrJson) throw new ValidationError("Esta foto não tem leitura automática para confirmar");

    const input = z.object({ createItem: z.boolean().default(false), item: itemInput.partial().optional() }).parse(req.body ?? {});

    const sugestao = (p.ocrJson ?? {}) as Record<string, unknown>;
    let criado: { id: string; name: string } | null = null;

    await prisma.$transaction(async (tx) => {
      await tx.partRequestPhoto.update({ where: { id: p.id }, data: { ocrConfirmedAt: new Date(), ocrConfirmedById: actor.id } });
      if (input.createItem) {
        if (p.partRequest._count.items >= MAX_ITEMS) throw new ValidationError(`Máximo de ${MAX_ITEMS} peças por solicitação`);
        // a confirmação da pessoa vence a sugestão da leitura
        const merged = itemInput.parse({ ...sugestao, ...(input.item ?? {}) });
        validateItem(merged);
        const item = await tx.partRequestItem.create({ data: { ...itemData(merged), partRequestId: p.partRequest.id } });
        criado = { id: item.id, name: item.name };
      }
    });

    // a foto confirmada precisa sobreviver ao assert, que é a regra de negócio
    assertOcrConfirmed({ ocrConfirmedAt: new Date(), ocrJson: p.ocrJson });
    return ok(res, { photoId: p.id, item: criado }, criado ? "Leitura confirmada e peça adicionada" : "Leitura confirmada");
  })
);

export default router;

