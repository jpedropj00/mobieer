import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDataFile } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { buildMirror, computeHourBank, fortalezaDay, inferKinds, looksLikeSamePerson, monthsBetween, parseTimeClockFile } from "./timeclock.service";

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

// GET /api/hr/timeclock/hour-bank?employeeId&from=YYYY-MM-DD&to=YYYY-MM-DD
// Banco de horas: saldos diários do espelho + ajustes manuais.
router.get(
  "/hour-bank",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const employeeId = String(req.query.employeeId ?? "").trim();
    if (!employeeId) throw new BadRequestError("employeeId é obrigatório");
    const employee = await ensureEmployee(employeeId, req.user!.organizationId);

    const now = new Date();
    const from = req.query.from ? new Date(`${String(req.query.from)}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(`${String(req.query.to)}T23:59:59`) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestError("Intervalo inválido");

    const entries = await prisma.timeEntry.findMany({
      where: { employeeId, timestamp: { gte: new Date(from.getFullYear(), from.getMonth(), 1), lt: new Date(to.getFullYear(), to.getMonth() + 1, 1) } },
      select: { timestamp: true, kind: true },
      orderBy: { timestamp: "asc" },
    });

    const fromKey = from.toISOString().slice(0, 10);
    const toKey = to.toISOString().slice(0, 10);
    const days = monthsBetween(from, to)
      .flatMap((month) => {
        const monthEntries = entries.filter((e) => e.timestamp.toISOString().slice(0, 7) === month);
        return buildMirror(monthEntries, month, employee.weeklyHours).days;
      })
      .filter((d) => d.date >= fromKey && d.date <= toKey);

    const adjustments = await prisma.hourBankAdjustment.findMany({
      where: { employeeId, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T00:00:00Z`) } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    });

    const summary = computeHourBank(days, adjustments);
    return ok(res, {
      employee: { id: employee.id, fullName: employee.fullName, registration: employee.registration, weeklyHours: employee.weeklyHours },
      from: fromKey,
      to: toKey,
      summary,
      days,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        date: a.date.toISOString().slice(0, 10),
        minutes: a.minutes,
        kind: a.kind,
        reason: a.reason,
        author: a.createdBy?.name ?? null,
        createdAt: a.createdAt,
      })),
    });
  })
);

// POST /api/hr/timeclock/hour-bank/adjustments  { employeeId, date, minutes, kind, reason? }
router.post(
  "/hour-bank/adjustments",
  requirePermission("hr.timeclock.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minutes: z.number().int().min(-100000).max(100000).refine((v) => v !== 0, "Informe um valor diferente de zero"),
        kind: z.enum(["ADJUSTMENT", "COMPENSATION", "PAYOUT"]).default("ADJUSTMENT"),
        reason: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body);
    await ensureEmployee(input.employeeId, req.user!.organizationId);
    const adj = await prisma.hourBankAdjustment.create({
      data: {
        organizationId: req.user!.organizationId,
        employeeId: input.employeeId,
        date: new Date(`${input.date}T00:00:00Z`),
        minutes: input.minutes,
        kind: input.kind,
        reason: input.reason?.trim() || null,
        createdById: req.user!.id,
      },
    });
    return ok(res, adj, "Lançamento registrado");
  })
);

// DELETE /api/hr/timeclock/hour-bank/adjustments/:id
router.delete(
  "/hour-bank/adjustments/:id",
  requirePermission("hr.timeclock.manage"),
  asyncHandler(async (req, res) => {
    const adj = await prisma.hourBankAdjustment.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!adj) throw new NotFoundError("Lançamento não encontrado");
    await prisma.hourBankAdjustment.delete({ where: { id: adj.id } });
    return ok(res, { id: adj.id }, "Lançamento removido");
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

/**
 * Lê o arquivo e monta o mapa "matrícula do relógio -> colaborador".
 * Usado pela conferência e pelo import, para os dois enxergarem a mesma coisa.
 */
async function mapPunches(buffer: Buffer, organizationId: string) {
  const parsed = parseTimeClockFile(buffer);
  const employees = await prisma.employee.findMany({ where: { organizationId }, select: { id: true, registration: true, fullName: true, status: true } });
  // Casa por matrícula exata OU pela parte numérica (ex.: "EMP-0002" <-> "0002" <-> "2").
  const digitsOf = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  const byReg = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    byReg.set(e.registration.toUpperCase(), e);
    const d = digitsOf(e.registration);
    if (d) byReg.set(d, e);
  }
  const lookup = (reg: string) => byReg.get(reg.toUpperCase()) ?? byReg.get(digitsOf(reg));

  const porMatricula = new Map<string, { registration: string; fileName: string | null; punches: typeof parsed.punches }>();
  for (const p of parsed.punches) {
    const cur = porMatricula.get(p.registration) ?? { registration: p.registration, fileName: p.name ?? null, punches: [] };
    if (!cur.fileName && p.name) cur.fileName = p.name;
    cur.punches.push(p);
    porMatricula.set(p.registration, cur);
  }

  const rows = [...porMatricula.values()]
    .map((g) => {
      const emp = lookup(g.registration);
      const times = g.punches.map((p) => p.timestamp.getTime());
      return {
        registration: g.registration,
        fileName: g.fileName,
        employee: emp ? { id: emp.id, registration: emp.registration, fullName: emp.fullName, status: emp.status } : null,
        punches: g.punches.length,
        from: new Date(Math.min(...times)),
        to: new Date(Math.max(...times)),
        // avisos que uma pessoa precisa olhar antes de gravar
        nameMismatch: Boolean(emp) && !looksLikeSamePerson(g.fileName, emp!.fullName),
        inactive: emp?.status !== undefined && emp.status !== "ACTIVE",
      };
    })
    .sort((a, b) => Number(a.registration) - Number(b.registration) || a.registration.localeCompare(b.registration));

  return { parsed, rows };
}

// POST /api/hr/timeclock/import/preview -> confere antes de gravar
router.post(
  "/import/preview",
  requirePermission("hr.timeclock.manage"),
  uploadDataFile.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do relógio de ponto");
    const { parsed, rows } = await mapPunches(req.file.buffer, req.user!.organizationId);
    if (parsed.punches.length === 0) {
      throw new BadRequestError("Nenhuma marcação reconhecida no arquivo. Formatos aceitos: exportação com cabeçalho (EnNo/DateTime) ou matrícula; data; hora.");
    }
    const naoEncontrados = rows.filter((r) => !r.employee);
    const divergentes = rows.filter((r) => r.nameMismatch);
    return ok(res, {
      fileName: req.file.originalname,
      totalPunches: parsed.punches.length,
      rowsError: parsed.errors,
      rows,
      warnings: {
        unmatched: naoEncontrados.map((r) => ({ registration: r.registration, fileName: r.fileName, punches: r.punches })),
        nameMismatch: divergentes.map((r) => ({ registration: r.registration, fileName: r.fileName, employee: r.employee!.fullName })),
      },
      // o import só grava com confirmarDivergencias quando há nome diferente
      requiresConfirmation: divergentes.length > 0,
    });
  })
);

// POST /api/hr/timeclock/import  (multipart: file exportado do aparelho)
router.post(
  "/import",
  requirePermission("hr.timeclock.manage"),
  uploadDataFile.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("Envie o arquivo exportado do relógio de ponto");
    const confirmarDivergencias = String(req.body?.confirmarDivergencias ?? "") === "true";
    const { parsed, rows } = await mapPunches(req.file.buffer, req.user!.organizationId);
    if (parsed.punches.length === 0) {
      throw new BadRequestError("Nenhuma marcação reconhecida no arquivo. Formatos aceitos: exportação com cabeçalho (EnNo/DateTime) ou matrícula; data; hora.");
    }
    // Nome do relógio diferente do cadastro: quase sempre é matrícula reaproveitada.
    // Gravar ponto na pessoa errada é grave, então isso exige confirmação explícita.
    const divergentes = rows.filter((r) => r.nameMismatch);
    if (divergentes.length && !confirmarDivergencias) {
      throw new BadRequestError(
        `O nome no relógio não bate com o cadastro em ${divergentes.length} matrícula(s): ` +
          divergentes.map((d) => `${d.registration} "${d.fileName}" -> "${d.employee!.fullName}"`).join("; ") +
          ". Confira em Conferir arquivo antes de importar."
      );
    }

    const byRegistration = new Map(rows.filter((r) => r.employee).map((r) => [r.registration, r.employee!.id]));
    const lookup = (reg: string) => byRegistration.get(reg);

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
    const groups = new Map<string, { employeeId: string; day: string; punches: { at: Date; label?: string | null }[] }>();
    let unmatched = 0;
    for (const p of parsed.punches) {
      const empId = lookup(p.registration);
      if (!empId) {
        unmatched++;
        continue;
      }
      // dia da loja: uma batida às 22h pertence ao dia dela, não ao seguinte em UTC
      const day = fortalezaDay(p.timestamp);
      const gkey = `${empId}|${day}`;
      const g = groups.get(gkey) ?? { employeeId: empId, day, punches: [] };
      g.punches.push({ at: p.timestamp, label: p.label });
      groups.set(gkey, g);
    }

    const data: { organizationId: string; employeeId: string; timestamp: Date; kind: "IN" | "OUT" | "BREAK_OUT" | "BREAK_IN"; source: "DEVICE_IMPORT"; importId: string; note: string | null }[] = [];
    for (const g of groups.values()) {
      const sorted = g.punches.slice().sort((a, b) => a.at.getTime() - b.at.getTime());
      // o tipo vem da ordem do dia; o rótulo do aparelho fica só como registro
      const kinds = inferKinds(sorted.map((s) => s.at));
      sorted.forEach((s2, i) => {
        data.push({ organizationId: req.user!.organizationId, employeeId: g.employeeId, timestamp: s2.at, kind: kinds[i], source: "DEVICE_IMPORT", importId: imp.id, note: s2.label ?? null });
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
