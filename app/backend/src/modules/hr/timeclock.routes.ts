import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDataFile } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { buildMirror, inferKinds, parseTimeClockFile } from "./timeclock.service";

const router = Router();
router.use(authenticate);

async function ensureEmployee(id: string, organizationId: string) {
  const e = await prisma.employee.findFirst({ where: { id, organizationId } });
  if (!e) throw new NotFoundError("Colaborador não encontrado");
  return e;
}

// GET /api/hr/timeclock/entries?employeeId&from&to
router.get(
  "/entries",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.query.employeeId ?? "").trim();
    if (!employeeId) throw new BadRequestError("employeeId é obrigatório");
    await ensureEmployee(employeeId, req.user!.organizationId);
    const where: { employeeId: string; timestamp?: { gte?: Date; lte?: Date } } = { employeeId };
    if (req.query.from || req.query.to) {
      where.timestamp = {};
      if (req.query.from) where.timestamp.gte = new Date(String(req.query.from));
      if (req.query.to) where.timestamp.lte = new Date(String(req.query.to));
    }
    const rows = await prisma.timeEntry.findMany({ where, orderBy: { timestamp: "asc" } });
    return ok(res, rows);
  })
);

// GET /api/hr/timeclock/mirror?employeeId&month=YYYY-MM  -> espelho de ponto
router.get(
  "/mirror",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.query.employeeId ?? "").trim();
    const month = String(req.query.month ?? "").trim();
    if (!employeeId || !/^\d{4}-\d{2}$/.test(month)) throw new BadRequestError("Informe employeeId e month (YYYY-MM)");
    const employee = await ensureEmployee(employeeId, req.user!.organizationId);
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    const entries = await prisma.timeEntry.findMany({
      where: { employeeId, timestamp: { gte: start, lt: end } },
      select: { timestamp: true, kind: true },
      orderBy: { timestamp: "asc" },
    });
    const mirror = buildMirror(entries, month, employee.weeklyHours);
    return ok(res, {
      employee: { id: employee.id, fullName: employee.fullName, registration: employee.registration, weeklyHours: employee.weeklyHours },
      month,
      ...mirror,
    });
  })
);

// POST /api/hr/timeclock/entries  (manual)
router.post(
  "/entries",
  requirePermission("hr.timeclock.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        timestamp: z.coerce.date(),
        kind: z.enum(["IN", "OUT", "BREAK_OUT", "BREAK_IN"]),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body);
    await ensureEmployee(input.employeeId, req.user!.organizationId);
    const entry = await prisma.timeEntry.upsert({
      where: { employeeId_timestamp: { employeeId: input.employeeId, timestamp: input.timestamp } },
      create: {
        organizationId: req.user!.organizationId,
        employeeId: input.employeeId,
        timestamp: input.timestamp,
        kind: input.kind,
        source: "MANUAL",
        note: input.note ?? null,
        createdById: req.user!.id,
      },
      update: { kind: input.kind, note: input.note ?? null, source: "MANUAL", createdById: req.user!.id },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "TIMEENTRY_MANUAL", entity: "TimeEntry", entityId: entry.id, details: { employeeId: input.employeeId } },
    });
    return ok(res, entry, "Marcação registrada");
  })
);

// DELETE /api/hr/timeclock/entries/:id
router.delete(
  "/entries/:id",
  requirePermission("hr.timeclock.manage"),
  asyncHandler(async (req, res) => {
    const entry = await prisma.timeEntry.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!entry) throw new NotFoundError("Marcação não encontrada");
    await prisma.timeEntry.delete({ where: { id: entry.id } });
    return ok(res, { id: entry.id }, "Marcação removida");
  })
);

// POST /api/hr/timeclock/import  (multipart: file exportado do aparelho)
router.post(
  "/import",
  requirePermission("hr.timeclock.manage"),
  uploadDataFile.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do relógio de ponto");
    const parsed = parseTimeClockFile(req.file.buffer);
    if (parsed.punches.length === 0) {
      throw new BadRequestError("Nenhuma marcação reconhecida no arquivo. Layout esperado: matrícula; data; hora.");
    }

    const employees = await prisma.employee.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, registration: true },
    });
    // Casa por matrícula exata OU pela parte numérica (ex.: "EMP-0002" <-> "0002" <-> "2").
    const digitsOf = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
    const byReg = new Map<string, string>();
    for (const e of employees) {
      byReg.set(e.registration.toUpperCase(), e.id);
      const d = digitsOf(e.registration);
      if (d) byReg.set(d, e.id);
    }
    const lookup = (reg: string) => byReg.get(reg.toUpperCase()) ?? byReg.get(digitsOf(reg));

    const timestamps = parsed.punches.map((p) => p.timestamp.getTime());
    const periodFrom = new Date(Math.min(...timestamps));
    const periodTo = new Date(Math.max(...timestamps));

    const imp = await prisma.timeEntryImport.create({
      data: {
        organizationId: req.user!.organizationId,
        fileName: req.file.originalname,
        periodFrom,
        periodTo,
        importedById: req.user!.id,
        rowsOk: 0,
        rowsError: parsed.errors,
      },
    });

    // agrupa por colaborador+dia para inferir o tipo de marcação
    const groups = new Map<string, { employeeId: string; day: string; times: Date[] }>();
    let unmatched = 0;
    for (const p of parsed.punches) {
      const empId = lookup(p.registration);
      if (!empId) {
        unmatched++;
        continue;
      }
      const day = p.timestamp.toISOString().slice(0, 10);
      const gkey = `${empId}|${day}`;
      const g = groups.get(gkey) ?? { employeeId: empId, day, times: [] };
      g.times.push(p.timestamp);
      groups.set(gkey, g);
    }

    const data: { organizationId: string; employeeId: string; timestamp: Date; kind: "IN" | "OUT" | "BREAK_OUT" | "BREAK_IN"; source: "DEVICE_IMPORT"; importId: string }[] = [];
    for (const g of groups.values()) {
      const sorted = g.times.slice().sort((a, b) => a.getTime() - b.getTime());
      const kinds = inferKinds(sorted);
      sorted.forEach((t, i) => {
        data.push({ organizationId: req.user!.organizationId, employeeId: g.employeeId, timestamp: t, kind: kinds[i], source: "DEVICE_IMPORT", importId: imp.id });
      });
    }

    const created = await prisma.timeEntry.createMany({ data, skipDuplicates: true });
    await prisma.timeEntryImport.update({
      where: { id: imp.id },
      data: { rowsOk: created.count, rowsError: parsed.errors + unmatched },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "TIMEENTRY_IMPORT", entity: "TimeEntryImport", entityId: imp.id, details: { fileName: req.file.originalname, ok: created.count } },
    });

    return ok(
      res,
      {
        importId: imp.id,
        reconhecidas: parsed.punches.length,
        importadas: created.count,
        semColaborador: unmatched,
        linhasInvalidas: parsed.errors,
        periodo: { de: periodFrom, ate: periodTo },
      },
      "Arquivo importado"
    );
  })
);

// GET /api/hr/timeclock/imports  (histórico)
router.get(
  "/imports",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.timeEntryImport.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return ok(res, rows);
  })
);

export default router;
