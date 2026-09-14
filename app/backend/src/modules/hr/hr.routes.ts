import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storage, buildStorageKey } from "../../lib/storage";
import { uploadDocument } from "../../middlewares/upload";
import { computeHrAlerts, countVacationDays, nextRegistration } from "./hr.service";
import { holidaysForYear, runHolidayNotices, upcomingHolidays, ymd } from "./holidays.service";
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
  address: nullable(255),
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
        address: input.address || null,
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
        address: input.address === undefined ? undefined : input.address || null,
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

// ---------------- Documentos do colaborador ----------------
// Contrato assinado, rescisão, comprovantes de férias, termo de
// responsabilidade de ferramentas, regulamento interno etc.
// employeeId ausente na query/corpo = documentos gerais do RH (não presos
// a um colaborador específico, ex.: regulamento interno).

const employeeDocInclude = {
  employee: { select: { id: true, fullName: true, registration: true } },
  uploadedBy: { select: { id: true, name: true } },
} as const;

const serializeEmployeeDoc = (d: {
  id: string; type: string; title: string; fileName: string; mimeType: string; sizeBytes: number;
  notes: string | null; createdAt: Date; employeeId: string | null;
  employee: { id: string; fullName: string; registration: string } | null;
  uploadedBy: { id: string; name: string } | null;
}) => ({
  id: d.id, type: d.type, title: d.title, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
  notes: d.notes, createdAt: d.createdAt, employeeId: d.employeeId, employee: d.employee,
  uploadedBy: d.uploadedBy, downloadUrl: `/api/hr/employee-documents/${d.id}/download`,
});

// GET /api/hr/employee-documents?employeeId=  (sem employeeId -> documentos gerais do RH)
router.get(
  "/employee-documents",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : null;
    if (employeeId) await getEmployee(employeeId, req.user!.organizationId);
    const rows = await prisma.employeeDocument.findMany({
      where: { organizationId: req.user!.organizationId, employeeId },
      include: employeeDocInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serializeEmployeeDoc));
  })
);

// POST /api/hr/employee-documents  (multipart: file + employeeId?, type, title, notes?)
router.post(
  "/employee-documents",
  requirePermission("hr.employees.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    const input = z
      .object({
        employeeId: z.string().min(1).optional().nullable().or(z.literal("")),
        type: z.enum(["CONTRATO", "RESCISAO", "FERIAS", "RESPONSABILIDADE_FERRAMENTA", "REGULAMENTO_INTERNO", "OUTRO"]).default("OUTRO"),
        title: z.string().trim().min(2).max(255),
        notes: nullable(2000),
      })
      .parse(req.body);
    const employeeId = input.employeeId || null;
    if (employeeId) await getEmployee(employeeId, req.user!.organizationId);

    const key = buildStorageKey(`hr/${employeeId ?? "geral"}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    const doc = await prisma.employeeDocument.create({
      data: {
        organizationId: req.user!.organizationId,
        employeeId,
        type: input.type,
        title: input.title,
        storageKey: key,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        notes: input.notes || null,
        uploadedById: req.user!.id,
      },
      include: employeeDocInclude,
    });
    await audit(req.user!.id, "EMPLOYEE_DOCUMENT_UPLOADED", "EmployeeDocument", doc.id, { type: input.type, employeeId });
    return ok(res, serializeEmployeeDoc(doc), "Documento anexado");
  })
);

router.get(
  "/employee-documents/:id/download",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const doc = await prisma.employeeDocument.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!doc) throw new NotFoundError("Documento não encontrado");
    const signed = await storage.getSignedUrl(doc.storageKey, doc.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    stream.pipe(res);
  })
);

router.delete(
  "/employee-documents/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const doc = await prisma.employeeDocument.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!doc) throw new NotFoundError("Documento não encontrado");
    await storage.remove(doc.storageKey).catch(() => undefined);
    await prisma.employeeDocument.delete({ where: { id: doc.id } });
    await audit(req.user!.id, "EMPLOYEE_DOCUMENT_DELETED", "EmployeeDocument", doc.id);
    return ok(res, { id: doc.id }, "Documento removido");
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

// ---------------- Feriados ----------------
// Nacionais + estaduais (CE) + municipais (Fortaleza) saem do calendário;
// recessos e pontos facultativos da casa são cadastrados aqui.

// GET /api/hr/holidays?year=2026
router.get(
  "/holidays",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    if (year < 2000 || year > 2100) throw new BadRequestError("Ano inválido");
    const list = await holidaysForYear(req.user!.organizationId, year);
    return ok(res, { year, holidays: list });
  })
);

// GET /api/hr/holidays/upcoming?days=60
router.get(
  "/holidays/upcoming",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 400);
    return ok(res, await upcomingHolidays(req.user!.organizationId, days));
  })
);

// POST /api/hr/holidays  -> recesso / ponto facultativo da empresa
router.post(
  "/holidays",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato aaaa-mm-dd"),
        name: z.string().trim().min(2).max(200),
        scope: z.enum(["NACIONAL", "ESTADUAL", "MUNICIPAL", "EMPRESA"]).default("EMPRESA"),
        optional: z.boolean().default(false),
        notes: nullable(2000),
      })
      .parse(req.body);

    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestError("Data inválida");
    const existing = await prisma.companyHoliday.findFirst({
      where: { organizationId: req.user!.organizationId, date, name: input.name },
      select: { id: true },
    });
    if (existing) throw new BadRequestError("Já existe um feriado com esse nome nessa data");

    const row = await prisma.companyHoliday.create({
      data: {
        organizationId: req.user!.organizationId,
        date,
        name: input.name,
        scope: input.scope,
        optional: input.optional,
        notes: input.notes || null,
        createdById: req.user!.id,
      },
    });
    await audit(req.user!.id, "COMPANY_HOLIDAY_CREATED", "CompanyHoliday", row.id, { date: input.date, name: input.name });
    return ok(res, { id: row.id, date: ymd(row.date), name: row.name, scope: row.scope, optional: row.optional }, "Feriado cadastrado");
  })
);

// DELETE /api/hr/holidays/:id  (só os cadastrados pela empresa)
router.delete(
  "/holidays/:id",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const row = await prisma.companyHoliday.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!row) throw new NotFoundError("Feriado não encontrado");
    await prisma.companyHoliday.delete({ where: { id: row.id } });
    await audit(req.user!.id, "COMPANY_HOLIDAY_DELETED", "CompanyHoliday", row.id);
    return ok(res, { id: row.id }, "Feriado removido");
  })
);

// POST /api/hr/holidays/notify  -> dispara os avisos dos próximos dias
router.post(
  "/holidays/notify",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.body?.days) || 7, 1), 60);
    const result = await runHolidayNotices(days);
    return ok(res, result, result.holidays ? `${result.holidays} feriado(s) avisado(s)` : "Nenhum feriado novo para avisar");
  })
);

export default router;
