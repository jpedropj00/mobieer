import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { computeHrAlerts, countVacationDays, nextRegistration } from "./hr.service";
import timeclockRoutes from "./timeclock.routes";

const router = Router();
router.use(authenticate);
router.use("/timeclock", timeclockRoutes);

const nullable = (max: number) => z.string().trim().max(max).optional().nullable().or(z.literal(""));

const employeeSchema = z.object({
  fullName: z.string().trim().min(2).max(255),
  registration: z.string().trim().min(1).max(30).optional(),
  role: nullable(120),
  sector: nullable(120),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: nullable(30),
  admittedAt: z.coerce.date(),
  weeklyHours: z.coerce.number().int().min(1).max(60).default(44),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]).default("ACTIVE"),
  userId: z.string().min(1).optional().nullable().or(z.literal("")),
});

const periodSchema = z.object({
  accrualStart: z.coerce.date(),
  accrualEnd: z.coerce.date(),
  concessionLimit: z.coerce.date().optional(),
  daysEntitled: z.coerce.number().int().min(1).max(30).default(30),
});

const requestSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  sellDays: z.coerce.number().int().min(0).max(10).default(0),
  note: nullable(5000),
  periodId: z.string().min(1).optional().nullable(),
});

async function audit(userId: string, action: string, entity: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity, entityId, details } });
}

async function getEmployee(id: string, organizationId: string) {
  const e = await prisma.employee.findFirst({ where: { id, organizationId } });
  if (!e) throw new NotFoundError("Colaborador não encontrado");
  return e;
}

const employeeSummary = (e: {
  id: string; registration: string; fullName: string; role: string | null; sector: string | null;
  status: string; admittedAt: Date; user: { id: string; name: string } | null;
  vacationPeriods: { daysEntitled: number; daysTaken: number; concessionLimit: Date; status: string }[];
}) => {
  const open = e.vacationPeriods.find((p) => p.status !== "CONCLUDED");
  return {
    id: e.id,
    registration: e.registration,
    fullName: e.fullName,
    role: e.role,
    sector: e.sector,
    status: e.status,
    admittedAt: e.admittedAt,
    user: e.user,
    openPeriod: open
      ? { daysRemaining: open.daysEntitled - open.daysTaken, concessionLimit: open.concessionLimit }
      : null,
  };
};

// ---------------- Colaboradores ----------------

router.get(
  "/employees",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const rows = await prisma.employee.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(search
          ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { registration: { contains: search, mode: "insensitive" } }] }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        vacationPeriods: { select: { daysEntitled: true, daysTaken: true, concessionLimit: true, status: true } },
      },
      orderBy: { fullName: "asc" },
    });
    return ok(res, rows.map(employeeSummary));
  })
);

router.get(
  "/employees/:id",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const e = await prisma.employee.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        vacationPeriods: { orderBy: { accrualStart: "desc" } },
        vacationRequests: {
          orderBy: { startDate: "desc" },
          include: { decidedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!e) throw new NotFoundError("Colaborador não encontrado");
    return ok(res, e);
  })
);

router.post(
  "/employees",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = employeeSchema.parse(req.body);
    const registration = input.registration || (await nextRegistration(req.user!.organizationId));
    if (input.userId) {
      const linked = await prisma.user.findFirst({ where: { id: input.userId, organizationId: req.user!.organizationId } });
      if (!linked) throw new BadRequestError("Usuário inválido para vínculo");
    }
    const e = await prisma.employee.create({
      data: {
        organizationId: req.user!.organizationId,
        registration,
        fullName: input.fullName,
        role: input.role || null,
        sector: input.sector || null,
        email: input.email || null,
        phone: input.phone || null,
        admittedAt: input.admittedAt,
        weeklyHours: input.weeklyHours,
        status: input.status,
        userId: input.userId || null,
      },
    });
    await audit(req.user!.id, "EMPLOYEE_CREATED", "Employee", e.id, { registration });
    return ok(res, e, "Colaborador cadastrado");
  })
);

router.patch(
  "/employees/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    await getEmployee(req.params.id, req.user!.organizationId);
    const input = employeeSchema.partial().parse(req.body);
    const e = await prisma.employee.update({
      where: { id: req.params.id },
      data: {
        fullName: input.fullName,
        registration: input.registration,
        role: input.role === undefined ? undefined : input.role || null,
        sector: input.sector === undefined ? undefined : input.sector || null,
        email: input.email === undefined ? undefined : input.email || null,
        phone: input.phone === undefined ? undefined : input.phone || null,
        admittedAt: input.admittedAt,
        weeklyHours: input.weeklyHours,
        status: input.status,
        terminatedAt: input.status === "TERMINATED" ? new Date() : input.status ? null : undefined,
        userId: input.userId === undefined ? undefined : input.userId || null,
      },
    });
    await audit(req.user!.id, "EMPLOYEE_UPDATED", "Employee", e.id);
    return ok(res, e, "Colaborador atualizado");
  })
);

// ---------------- Períodos aquisitivos ----------------

router.post(
  "/employees/:id/periods",
  requirePermission("hr.vacations.manage"),
  asyncHandler(async (req, res) => {
    await getEmployee(req.params.id, req.user!.organizationId);
    const input = periodSchema.parse(req.body);
    if (input.accrualEnd <= input.accrualStart) throw new BadRequestError("Fim do período aquisitivo deve ser após o início");
    // Concessivo padrão: 12 meses após o fim do aquisitivo.
    const concessionLimit = input.concessionLimit ?? new Date(new Date(input.accrualEnd).setFullYear(input.accrualEnd.getFullYear() + 1));
    const period = await prisma.vacationPeriod.create({
      data: {
        employeeId: req.params.id,
        accrualStart: input.accrualStart,
        accrualEnd: input.accrualEnd,
        concessionLimit,
        daysEntitled: input.daysEntitled,
      },
    });
    await audit(req.user!.id, "VACATION_PERIOD_CREATED", "VacationPeriod", period.id, { employeeId: req.params.id });
    return ok(res, period, "Período aquisitivo criado");
  })
);

// ---------------- Solicitações de férias ----------------

router.get(
  "/vacations",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.vacationRequest.findMany({
      where: {
        employee: { organizationId: req.user!.organizationId },
        ...(req.query.status ? { status: req.query.status as never } : {}),
        ...(req.query.employeeId ? { employeeId: String(req.query.employeeId) } : {}),
      },
      include: {
        employee: { select: { id: true, fullName: true, registration: true, sector: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { startDate: "desc" }],
    });
    return ok(res, rows);
  })
);

router.post(
  "/vacations",
  requirePermission("hr.vacations.manage"),
  asyncHandler(async (req, res) => {
    const input = requestSchema.parse(req.body);
    const employee = await getEmployee(input.employeeId, req.user!.organizationId);
    if (employee.status === "TERMINATED") throw new BadRequestError("Colaborador desligado");
    if (input.endDate < input.startDate) throw new BadRequestError("Data final anterior à inicial");

    const days = countVacationDays(input.startDate, input.endDate);

    let periodId = input.periodId ?? null;
    if (!periodId) {
      const open = await prisma.vacationPeriod.findFirst({
        where: { employeeId: employee.id, status: { not: "CONCLUDED" } },
        orderBy: { concessionLimit: "asc" },
      });
      periodId = open?.id ?? null;
    }
    if (periodId) {
      const period = await prisma.vacationPeriod.findUnique({ where: { id: periodId } });
      if (period) {
        const remaining = period.daysEntitled - period.daysTaken;
        if (days + input.sellDays > remaining) {
          throw new BadRequestError(`Saldo insuficiente no período: ${remaining} dia(s) disponível(is), solicitados ${days + input.sellDays}.`);
        }
      }
    }

    const request = await prisma.vacationRequest.create({
      data: {
        employeeId: employee.id,
        periodId,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        sellDays: input.sellDays,
        note: input.note || null,
        status: "REQUESTED",
      },
    });
    await audit(req.user!.id, "VACATION_REQUESTED", "VacationRequest", request.id, { employeeId: employee.id, days });
    return ok(res, request, "Solicitação registrada");
  })
);

router.patch(
  "/vacations/:id",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const current = await prisma.vacationRequest.findFirst({
      where: { id: req.params.id, employee: { organizationId: req.user!.organizationId } },
      include: { employee: { select: { fullName: true, userId: true } } },
    });
    if (!current) throw new NotFoundError("Solicitação não encontrada");

    const { action, note } = z
      .object({ action: z.enum(["approve", "reject", "schedule", "mark_taken", "cancel"]), note: nullable(5000) })
      .parse(req.body);

    const perms = req.user!.permissions;
    const needApprove = action === "approve" || action === "reject";
    if (needApprove && !perms.includes("hr.vacations.approve")) throw new BadRequestError("Sem permissão para aprovar/recusar");
    if (!needApprove && !perms.includes("hr.vacations.manage")) throw new BadRequestError("Sem permissão para esta ação");

    const counted = current.days + current.sellDays;
    const wasHolding = current.status === "APPROVED" || current.status === "SCHEDULED";

    const result = await prisma.$transaction(async (tx) => {
      let status = current.status;
      const data: Record<string, unknown> = { note: note ?? current.note };

      if (action === "approve") {
        if (current.status !== "REQUESTED") throw new BadRequestError("Só é possível aprovar solicitações pendentes");
        status = "APPROVED";
        data.decidedById = req.user!.id;
        data.decidedAt = new Date();
        if (current.periodId) {
          await tx.vacationPeriod.update({ where: { id: current.periodId }, data: { daysTaken: { increment: counted }, status: "SCHEDULED" } });
        }
      } else if (action === "reject") {
        if (current.status !== "REQUESTED") throw new BadRequestError("Só é possível recusar solicitações pendentes");
        status = "REJECTED";
        data.decidedById = req.user!.id;
        data.decidedAt = new Date();
      } else if (action === "schedule") {
        if (current.status !== "APPROVED") throw new BadRequestError("Agende apenas solicitações aprovadas");
        status = "SCHEDULED";
      } else if (action === "mark_taken") {
        if (current.status !== "APPROVED" && current.status !== "SCHEDULED") throw new BadRequestError("Marque como usufruída apenas férias aprovadas/agendadas");
        status = "TAKEN";
        if (current.periodId) {
          const p = await tx.vacationPeriod.findUnique({ where: { id: current.periodId } });
          if (p && p.daysTaken >= p.daysEntitled) {
            await tx.vacationPeriod.update({ where: { id: p.id }, data: { status: "CONCLUDED" } });
          }
        }
      } else if (action === "cancel") {
        if (current.status === "TAKEN" || current.status === "CANCELLED") throw new BadRequestError("Solicitação já finalizada");
        status = "CANCELLED";
        if (wasHolding && current.periodId) {
          await tx.vacationPeriod.update({ where: { id: current.periodId }, data: { daysTaken: { decrement: counted }, status: "OPEN" } });
        }
      }

      return tx.vacationRequest.update({ where: { id: current.id }, data: { ...data, status } });
    });

    await audit(req.user!.id, `VACATION_${action.toUpperCase()}`, "VacationRequest", current.id);

    if (action === "approve" && current.employee.userId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          title: "Férias aprovadas",
          message: `Suas férias de ${current.startDate.toLocaleDateString("pt-BR")} a ${current.endDate.toLocaleDateString("pt-BR")} foram aprovadas.`,
          userId: current.employee.userId,
        },
      });
    }

    return ok(res, result, "Solicitação atualizada");
  })
);

// ---------------- Alertas ----------------

router.get(
  "/alerts",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    return ok(res, await computeHrAlerts(req.user!.organizationId));
  })
);

export default router;
