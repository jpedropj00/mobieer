import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { BonusStatus, InstallationReview, InstallationStatus, Prisma, RoomType } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "../../utils/ApiError";
import { enumQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { localPeriod } from "./contractors.service";
import {
  getBonusPolicy,
  reviewTask,
  serializeTask,
  taskInclude,
} from "./installation.service";
import { ROOM_LABEL, ROOM_TYPES, buildProductivityReport, normalizeTiers } from "./productivity.service";

/** Gestão dos montadores: /api/installations */
const router = Router();
router.use(authenticate);

const num = (v: unknown) => Number(v ?? 0) || 0;

// GET /api/installations/room-types
router.get(
  "/room-types",
  requirePermission("hr.read"),
  asyncHandler(async (_req, res) => ok(res, ROOM_TYPES.map((key) => ({ key, label: ROOM_LABEL[key] }))))
);

// ---------------- Acesso do montador ao sistema ----------------

/** Senha provisória legível (sem 0/O/1/l). */
function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

// POST /api/installations/contractors/:id/access { email, password? }
router.post(
  "/contractors/:id/access",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const contractor = await prisma.contractor.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!contractor) throw new NotFoundError("Montador não encontrado");
    if (!contractor.active) throw new InvalidStateError("Montador desativado: reative o cadastro antes de liberar o acesso");
    const input = z
      .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(100).optional() })
      .parse(req.body);

    const role = await prisma.role.findUnique({ where: { name: "MONTADOR" }, select: { id: true } });
    if (!role) throw new InvalidStateError("Perfil MONTADOR não existe — rode as migrations");

    const password = input.password ?? tempPassword();
    const hash = await bcrypt.hash(password, 10);

    if (contractor.userId) {
      // já tem acesso: redefine e-mail/senha e reativa
      const clash = await prisma.user.findFirst({ where: { email: input.email, id: { not: contractor.userId } }, select: { id: true } });
      if (clash) throw new ConflictError("Este e-mail já é usado por outro usuário", undefined, "DUPLICATE");
      await prisma.user.update({ where: { id: contractor.userId }, data: { email: input.email, password: hash, status: "ACTIVE", name: contractor.name } });
    } else {
      if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw new ConflictError("Este e-mail já é usado por outro usuário", undefined, "DUPLICATE");
      }
      const user = await prisma.user.create({
        data: {
          name: contractor.name,
          email: input.email,
          password: hash,
          position: contractor.specialty ?? "Montador terceirizado",
          sector: "Montagem",
          roleId: role.id,
          organizationId: req.user!.organizationId,
        },
      });
      await prisma.contractor.update({ where: { id: contractor.id }, data: { userId: user.id } });
    }
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "CONTRACTOR_ACCESS_GRANTED", entity: "Contractor", entityId: contractor.id, details: { email: input.email } },
    });
    // A senha só é devolvida aqui, uma vez, para a gestão repassar ao montador.
    return ok(res, { email: input.email, temporaryPassword: input.password ? null : password }, "Acesso liberado");
  })
);

// DELETE /api/installations/contractors/:id/access -> bloqueia o login (mantém histórico)
router.delete(
  "/contractors/:id/access",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const contractor = await prisma.contractor.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!contractor?.userId) throw new NotFoundError("Este montador não tem acesso ao sistema");
    await prisma.user.update({ where: { id: contractor.userId }, data: { status: "INACTIVE" } });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "CONTRACTOR_ACCESS_REVOKED", entity: "Contractor", entityId: contractor.id },
    });
    return ok(res, { id: contractor.id }, "Acesso bloqueado");
  })
);

// GET /api/installations/contractors/access -> quem tem login
router.get(
  "/contractors/access",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.contractor.findMany({
      where: { organizationId: req.user!.organizationId, userId: { not: null } },
      select: { id: true, user: { select: { email: true, status: true, lastLogin: true } } },
    });
    return ok(res, rows.map((r) => ({ contractorId: r.id, email: r.user?.email ?? null, status: r.user?.status ?? null, lastLogin: r.user?.lastLogin ?? null })));
  })
);

// ---------------- Cômodos ----------------

// GET /api/installations?status=&review=&contractorId=&projectId=
router.get(
  "/",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.installationTask.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.status ? { status: enumQuery(req.query.status, InstallationStatus, "status") } : {}),
        ...(req.query.review ? { review: enumQuery(req.query.review, InstallationReview, "review") } : {}),
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
        ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      },
      include: taskInclude,
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    });
    return ok(res, rows.map((r) => serializeTask(r)));
  })
);

const taskSchema = z.object({
  contractorId: z.string().min(1),
  projectId: z.string().min(1),
  roomType: z.nativeEnum(RoomType),
  roomLabel: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

// POST /api/installations -> gestão atribui um cômodo
router.post(
  "/",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = taskSchema.parse(req.body);
    const [contractor, project] = await Promise.all([
      prisma.contractor.findFirst({ where: { id: input.contractorId, organizationId: req.user!.organizationId }, select: { id: true, active: true, userId: true } }),
      prisma.project.findFirst({ where: { id: input.projectId, organizationId: req.user!.organizationId }, select: { id: true, code: true } }),
    ]);
    if (!contractor) throw new ValidationError("Montador inválido");
    if (!contractor.active) throw new InvalidStateError("Montador inativo");
    if (!project) throw new ValidationError("Projeto inválido");
    const t = await prisma.installationTask.create({
      data: {
        organizationId: req.user!.organizationId,
        contractorId: contractor.id,
        projectId: project.id,
        roomType: input.roomType,
        roomLabel: input.roomLabel || null,
        notes: input.notes || null,
        createdById: req.user!.id,
      },
      include: taskInclude,
    });
    if (contractor.userId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          userId: contractor.userId,
          title: "Novo cômodo para montar",
          message: `${input.roomLabel || ROOM_LABEL[input.roomType]} — ${project.code}.`,
        },
      });
    }
    return ok(res, serializeTask(t), "Cômodo atribuído");
  })
);

// PATCH /api/installations/:id -> correção pela gestão (antes de validar)
router.patch(
  "/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.installationTask.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Cômodo não encontrado");
    if (cur.review !== "PENDING") throw new InvalidStateError("Cômodo já validado não pode ser alterado");
    const input = z
      .object({
        roomType: z.nativeEnum(RoomType).optional(),
        roomLabel: z.string().trim().max(120).optional().nullable(),
        workedMinutes: z.coerce.number().int().min(0).max(60 * 24 * 14).optional(),
        notes: z.string().trim().max(2000).optional().nullable(),
        cancel: z.boolean().optional(),
      })
      .parse(req.body);
    if (input.workedMinutes !== undefined && cur.status !== "DONE") {
      throw new InvalidStateError("Ajuste o tempo depois que o cômodo for concluído");
    }
    const t = await prisma.installationTask.update({
      where: { id: cur.id },
      data: {
        roomType: input.roomType,
        roomLabel: input.roomLabel === undefined ? undefined : input.roomLabel || null,
        workedMinutes: input.workedMinutes,
        notes: input.notes === undefined ? undefined : input.notes || null,
        ...(input.cancel ? { status: "CANCELLED" as const } : {}),
      },
      include: taskInclude,
    });
    return ok(res, serializeTask(t), input.cancel ? "Cômodo cancelado" : "Cômodo atualizado");
  })
);

// POST /api/installations/:id/review { decision, notes? }
router.post(
  "/:id/review",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), notes: z.string().trim().max(2000).optional().nullable() }).parse(req.body);
    if (input.decision === "REJECTED" && !input.notes) throw new ValidationError("Explique o que precisa de ajuste");
    const { task, bonus } = await reviewTask({
      taskId: req.params.id,
      organizationId: req.user!.organizationId,
      reviewerId: req.user!.id,
      decision: input.decision,
      notes: input.notes ?? null,
    });
    return ok(
      res,
      { task: serializeTask(task), bonus },
      input.decision === "REJECTED" ? "Cômodo reprovado" : bonus.amount > 0 ? `Aprovado — bônus de R$ ${bonus.amount.toFixed(2)}` : `Aprovado — ${bonus.reason}`
    );
  })
);

// ---------------- Bonificação ----------------

// GET /api/installations/bonus-policy
router.get(
  "/bonus-policy",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => ok(res, await getBonusPolicy(req.user!.organizationId)))
);

// PUT /api/installations/bonus-policy { enabled, minSamples, tiers, maxPerMonth }
router.put(
  "/bonus-policy",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        enabled: z.boolean(),
        minSamples: z.coerce.number().int().min(1).max(10),
        tiers: z.array(z.object({ minGainPct: z.coerce.number(), amount: z.coerce.number() })).min(1).max(6),
        maxPerMonth: z.coerce.number().min(0).max(1e6).nullable().optional(),
      })
      .parse(req.body);
    const tiers = normalizeTiers(input.tiers);
    const data = {
      enabled: input.enabled,
      minSamples: input.minSamples,
      tiers: tiers as unknown as Prisma.InputJsonValue,
      maxPerMonth: input.maxPerMonth == null ? null : new Prisma.Decimal(input.maxPerMonth),
      updatedById: req.user!.id,
    };
    await prisma.bonusPolicy.upsert({
      where: { organizationId: req.user!.organizationId },
      create: { organizationId: req.user!.organizationId, ...data },
      update: data,
    });
    return ok(res, await getBonusPolicy(req.user!.organizationId), "Regra de bonificação salva");
  })
);

// GET /api/installations/bonuses?status=&contractorId=&from=&to=
router.get(
  "/bonuses",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const period = req.query.from || req.query.to ? localPeriod(req.query.from, req.query.to) : null;
    const rows = await prisma.contractorBonus.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.status ? { status: enumQuery(req.query.status, BonusStatus, "status") } : {}),
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
        ...(period ? { createdAt: { gte: period.from, lte: period.to } } : {}),
      },
      include: {
        contractor: { select: { id: true, name: true } },
        task: { select: { roomLabel: true, project: { select: { code: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return ok(
      res,
      rows.map((b) => ({
        id: b.id,
        contractor: b.contractor,
        roomType: b.roomType,
        roomTypeLabel: ROOM_LABEL[b.roomType],
        roomLabel: b.task.roomLabel,
        project: b.task.project,
        targetMinutes: b.targetMinutes,
        actualMinutes: b.actualMinutes,
        gainPct: num(b.gainPct),
        amount: num(b.amount),
        status: b.status,
        paidAt: b.paidAt,
        createdAt: b.createdAt,
      }))
    );
  })
);

// POST /api/installations/bonuses/:id/pay | /cancel
router.post(
  "/bonuses/:id/:action(pay|cancel)",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const b = await prisma.contractorBonus.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!b) throw new NotFoundError("Bônus não encontrado");
    const pay = req.params.action === "pay";
    if (pay && b.status !== "APPROVED") throw new InvalidStateError("Só bônus aprovado pode ser marcado como pago");
    if (!pay && b.status === "PAID") throw new InvalidStateError("Bônus já pago não pode ser cancelado");
    await prisma.contractorBonus.update({
      where: { id: b.id },
      data: pay ? { status: "PAID", paidAt: new Date(), decidedById: req.user!.id } : { status: "CANCELLED", decidedById: req.user!.id },
    });
    return ok(res, { id: b.id }, pay ? "Bônus marcado como pago" : "Bônus cancelado");
  })
);

// ---------------- Relatório de produtividade ----------------

// GET /api/installations/productivity?from=&to=&contractorId=
router.get(
  "/productivity",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const { from, to } = localPeriod(req.query.from, req.query.to, 90);
    const tasks = await prisma.installationTask.findMany({
      where: {
        organizationId: req.user!.organizationId,
        status: "DONE",
        review: "APPROVED",
        finishedAt: { gte: from, lte: to },
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
      },
      select: {
        contractorId: true,
        roomType: true,
        workedMinutes: true,
        targetMinutes: true,
        finishedAt: true,
        contractor: { select: { name: true } },
        bonus: { select: { amount: true, status: true } },
      },
    });
    const report = buildProductivityReport(
      tasks.map((t) => ({
        contractorId: t.contractorId,
        contractorName: t.contractor.name,
        roomType: t.roomType,
        workedMinutes: t.workedMinutes,
        targetMinutes: t.targetMinutes,
        finishedAt: t.finishedAt,
        bonusAmount: t.bonus && t.bonus.status !== "CANCELLED" ? num(t.bonus.amount) : 0,
      }))
    );
    const pendingReview = await prisma.installationTask.count({
      where: { organizationId: req.user!.organizationId, status: "DONE", review: "PENDING" },
    });
    return ok(res, { from, to, pendingReview, ...report });
  })
);

export default router;
