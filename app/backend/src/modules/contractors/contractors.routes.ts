/**
 * Montadores terceirizados: cadastro, check-in/check-out na obra, contagem de
 * horas e de diárias.
 *
 * A diária é congelada no turno (`ContractorShift.dailyRate`) no momento do
 * check-in — reajustar o cadastro depois não muda o que já foi trabalhado.
 * "Dias" para pagamento = turnos distintos por data (dois turnos no mesmo dia
 * contam como uma diária só).
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { localDay, localPeriod, shiftMinutes, summarizeShifts } from "./contractors.service";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const num = (v: Prisma.Decimal | null | undefined) => (v != null ? Number(v) : 0);


async function ensureContractor(id: string, organizationId: string) {
  const c = await prisma.contractor.findFirst({ where: { id, organizationId } });
  if (!c) throw new NotFoundError("Montador não encontrado");
  return c;
}

const serializeContractor = (c: {
  id: string; name: string; document: string | null; phone: string | null; address: string | null;
  specialty: string | null; dailyRate: Prisma.Decimal; active: boolean; notes: string | null; createdAt: Date;
  shifts?: { checkOutAt: Date | null }[];
}) => ({
  id: c.id,
  name: c.name,
  document: c.document,
  phone: c.phone,
  address: c.address,
  specialty: c.specialty,
  dailyRate: num(c.dailyRate),
  active: c.active,
  notes: c.notes,
  createdAt: c.createdAt,
  /** Está na obra agora (tem turno aberto). */
  onSite: (c.shifts ?? []).some((s) => s.checkOutAt === null),
});

const serializeShift = (s: {
  id: string; contractorId: string; projectId: string | null; checkInAt: Date; checkOutAt: Date | null;
  minutes: number | null; dailyRate: Prisma.Decimal; notes: string | null;
  contractor?: { id: string; name: string } | null;
  project?: { id: string; code: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
}) => ({
  id: s.id,
  contractorId: s.contractorId,
  projectId: s.projectId,
  checkInAt: s.checkInAt,
  checkOutAt: s.checkOutAt,
  minutes: s.minutes,
  hours: s.minutes != null ? Math.round((s.minutes / 60) * 100) / 100 : null,
  dailyRate: num(s.dailyRate),
  day: localDay(s.checkInAt),
  open: s.checkOutAt === null,
  notes: s.notes,
  contractor: s.contractor ?? null,
  project: s.project ?? null,
  createdBy: s.createdBy ?? null,
});

const shiftInclude = {
  contractor: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

// ---------------- Cadastro ----------------

// GET /api/contractors?active=1&q=
router.get(
  "/",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const q = req.query.q ? String(req.query.q).trim() : "";
    const rows = await prisma.contractor.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.active === "1" ? { active: true } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      include: { shifts: { where: { checkOutAt: null }, select: { checkOutAt: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    return ok(res, rows.map(serializeContractor));
  })
);

const contractorSchema = z.object({
  name: z.string().trim().min(2).max(200),
  document: z.string().trim().max(30).optional().nullable().or(z.literal("")),
  phone: z.string().trim().max(30).optional().nullable().or(z.literal("")),
  address: z.string().trim().max(255).optional().nullable().or(z.literal("")),
  specialty: z.string().trim().max(120).optional().nullable().or(z.literal("")),
  dailyRate: z.coerce.number().min(0).max(99999999).default(0),
  notes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
});

// POST /api/contractors
router.post(
  "/",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = contractorSchema.parse(req.body);
    const c = await prisma.contractor.create({
      data: {
        organizationId: req.user!.organizationId,
        name: input.name,
        document: nn(input.document),
        phone: nn(input.phone),
        address: nn(input.address),
        specialty: nn(input.specialty),
        dailyRate: new Prisma.Decimal(input.dailyRate),
        notes: nn(input.notes),
      },
    });
    return ok(res, serializeContractor({ ...c, shifts: [] }), "Montador cadastrado");
  })
);

// PATCH /api/contractors/:id
router.patch(
  "/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureContractor(req.params.id, req.user!.organizationId);
    const input = contractorSchema.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const c = await prisma.contractor.update({
      where: { id: cur.id },
      data: {
        name: input.name,
        document: input.document === undefined ? undefined : nn(input.document),
        phone: input.phone === undefined ? undefined : nn(input.phone),
        address: input.address === undefined ? undefined : nn(input.address),
        specialty: input.specialty === undefined ? undefined : nn(input.specialty),
        dailyRate: input.dailyRate === undefined ? undefined : new Prisma.Decimal(input.dailyRate),
        notes: input.notes === undefined ? undefined : nn(input.notes),
        active: input.active,
      },
      include: { shifts: { where: { checkOutAt: null }, select: { checkOutAt: true } } },
    });
    return ok(res, serializeContractor(c), "Montador atualizado");
  })
);

// DELETE /api/contractors/:id  -> só se nunca trabalhou; senão, desativa.
router.delete(
  "/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const cur = await ensureContractor(req.params.id, req.user!.organizationId);
    const shifts = await prisma.contractorShift.count({ where: { contractorId: cur.id } });
    if (shifts > 0) {
      const c = await prisma.contractor.update({
        where: { id: cur.id },
        data: { active: false },
        include: { shifts: { where: { checkOutAt: null }, select: { checkOutAt: true } } },
      });
      return ok(res, serializeContractor(c), "Montador tem turnos registrados — foi desativado em vez de excluído");
    }
    await prisma.contractor.delete({ where: { id: cur.id } });
    return ok(res, { id: cur.id }, "Montador removido");
  })
);

// ---------------- Turnos (check-in / check-out) ----------------

// GET /api/contractors/shifts?contractorId=&projectId=&from=&to=&open=1
router.get(
  "/shifts",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const hasPeriod = Boolean(req.query.from || req.query.to);
    const period = hasPeriod ? localPeriod(req.query.from, req.query.to) : null;

    const rows = await prisma.contractorShift.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
        ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
        ...(req.query.open === "1" ? { checkOutAt: null } : {}),
        ...(period ? { checkInAt: { gte: period.from, lte: period.to } } : {}),
      },
      include: shiftInclude,
      orderBy: { checkInAt: "desc" },
      take: 500,
    });
    return ok(res, rows.map(serializeShift));
  })
);

// POST /api/contractors/:id/check-in  { projectId?, at?, notes? }
router.post(
  "/:id/check-in",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const c = await ensureContractor(req.params.id, req.user!.organizationId);
    if (!c.active) throw new BadRequestError("Montador inativo");
    const input = z
      .object({
        projectId: z.string().min(1).optional().nullable().or(z.literal("")),
        at: z.coerce.date().optional(),
        notes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const open = await prisma.contractorShift.findFirst({ where: { contractorId: c.id, checkOutAt: null }, select: { id: true } });
    if (open) throw new BadRequestError("Já existe um turno aberto para este montador — faça o check-out primeiro");

    const projectId = input.projectId || null;
    if (projectId) {
      const p = await prisma.project.findFirst({ where: { id: projectId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!p) throw new BadRequestError("Projeto inválido");
    }

    const checkInAt = input.at ?? new Date();
    if (checkInAt.getTime() > Date.now() + 5 * 60000) throw new BadRequestError("Check-in não pode ser no futuro");

    const shift = await prisma.contractorShift.create({
      data: {
        organizationId: req.user!.organizationId,
        contractorId: c.id,
        projectId,
        checkInAt,
        dailyRate: c.dailyRate, // congela a diária vigente
        notes: nn(input.notes),
        createdById: req.user!.id,
      },
      include: shiftInclude,
    });
    return ok(res, serializeShift(shift), "Check-in registrado");
  })
);

// POST /api/contractors/shifts/:shiftId/check-out  { at?, notes? }
router.post(
  "/shifts/:shiftId/check-out",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.contractorShift.findFirst({
      where: { id: req.params.shiftId, organizationId: req.user!.organizationId },
    });
    if (!cur) throw new NotFoundError("Turno não encontrado");
    if (cur.checkOutAt) throw new BadRequestError("Turno já encerrado");

    const input = z
      .object({ at: z.coerce.date().optional(), notes: z.string().trim().max(2000).optional().nullable().or(z.literal("")) })
      .parse(req.body);
    const checkOutAt = input.at ?? new Date();
    if (checkOutAt <= cur.checkInAt) throw new BadRequestError("Check-out deve ser depois do check-in");
    if (checkOutAt.getTime() > Date.now() + 5 * 60000) throw new BadRequestError("Check-out não pode ser no futuro");

    const minutes = shiftMinutes(cur.checkInAt, checkOutAt);
    const shift = await prisma.contractorShift.update({
      where: { id: cur.id },
      data: { checkOutAt, minutes, notes: input.notes === undefined ? undefined : nn(input.notes) },
      include: shiftInclude,
    });
    return ok(res, serializeShift(shift), `Check-out registrado — ${(minutes / 60).toFixed(2)}h`);
  })
);

// PATCH /api/contractors/shifts/:shiftId  -> corrigir horários/projeto/obs
router.patch(
  "/shifts/:shiftId",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.contractorShift.findFirst({
      where: { id: req.params.shiftId, organizationId: req.user!.organizationId },
    });
    if (!cur) throw new NotFoundError("Turno não encontrado");
    const input = z
      .object({
        checkInAt: z.coerce.date().optional(),
        checkOutAt: z.coerce.date().optional().nullable(),
        projectId: z.string().min(1).optional().nullable().or(z.literal("")),
        dailyRate: z.coerce.number().min(0).max(99999999).optional(),
        notes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    const checkInAt = input.checkInAt ?? cur.checkInAt;
    const checkOutAt = input.checkOutAt === undefined ? cur.checkOutAt : input.checkOutAt;
    if (checkOutAt && checkOutAt <= checkInAt) throw new BadRequestError("Check-out deve ser depois do check-in");

    if (input.projectId) {
      const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!p) throw new BadRequestError("Projeto inválido");
    }

    const shift = await prisma.contractorShift.update({
      where: { id: cur.id },
      data: {
        checkInAt,
        checkOutAt,
        minutes: checkOutAt ? shiftMinutes(checkInAt, checkOutAt) : null,
        projectId: input.projectId === undefined ? undefined : input.projectId || null,
        dailyRate: input.dailyRate === undefined ? undefined : new Prisma.Decimal(input.dailyRate),
        notes: input.notes === undefined ? undefined : nn(input.notes),
      },
      include: shiftInclude,
    });
    return ok(res, serializeShift(shift), "Turno atualizado");
  })
);

// DELETE /api/contractors/shifts/:shiftId
router.delete(
  "/shifts/:shiftId",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.contractorShift.findFirst({
      where: { id: req.params.shiftId, organizationId: req.user!.organizationId },
    });
    if (!cur) throw new NotFoundError("Turno não encontrado");
    await prisma.contractorShift.delete({ where: { id: cur.id } });
    return ok(res, { id: cur.id }, "Turno removido");
  })
);

// ---------------- Fechamento (horas, diárias e valor a pagar) ----------------

// GET /api/contractors/summary?from=&to=&contractorId=
router.get(
  "/summary",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const { from, to } = localPeriod(req.query.from, req.query.to);

    const shifts = await prisma.contractorShift.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
        checkInAt: { gte: from, lte: to },
      },
      include: { contractor: { select: { id: true, name: true } } },
      orderBy: { checkInAt: "asc" },
    });

    const summary = summarizeShifts(
      shifts.map((s) => ({
        contractorId: s.contractorId,
        contractorName: s.contractor.name,
        checkInAt: s.checkInAt,
        checkOutAt: s.checkOutAt,
        minutes: s.minutes,
        dailyRate: num(s.dailyRate),
      }))
    );

    return ok(res, { from, to, ...summary });
  })
);

export default router;
