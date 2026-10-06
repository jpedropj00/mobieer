/**
 * Presença dos montadores externos lançada pelo escritório: /api/contractors
 *
 *   GET    /attendance?from=&to=      grade do período (padrão: semana atual, segunda a sábado)
 *   PUT    /attendance                { contractorId, date, present, projectId?, notes? }
 *   DELETE /attendance                { contractorId, date }  — volta para "sem lançamento"
 *
 * "Veio" cria um turno de 8h às 17h com a diária vigente, para o dia entrar no
 * fechamento como qualquer check-in. Se o montador já bateu o ponto naquele
 * dia, nenhum turno extra é criado. Trocar para "não veio" (ou limpar) remove
 * só o turno que este lançamento criou — nunca o check-in feito pelo montador.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { attendanceShiftTimes, attendanceTotals, dayBounds, daysBetween, localDayOf, weekOf } from "./attendance.rules";

const router = Router();
router.use(authenticate);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

router.get(
  "/attendance",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const q = z.object({ from: day.optional(), to: day.optional() }).parse(req.query);
    const week = weekOf(q.from ?? localDayOf(new Date()));
    const from = q.from ?? week.from;
    const to = q.to ?? (q.from ? weekOf(q.from).to : week.to);
    if (to < from) throw new BadRequestError("O fim do período precisa ser depois do início");
    const days = daysBetween(from, to);
    const organizationId = req.user!.organizationId;

    const [contractors, records, shifts] = await Promise.all([
      prisma.contractor.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, userId: true, dailyRate: true }, orderBy: { name: "asc" } }),
      prisma.contractorAttendance.findMany({ where: { organizationId, date: { gte: asDate(from), lte: asDate(to) } }, select: { contractorId: true, date: true, present: true, notes: true, shiftId: true, project: { select: { id: true, code: true, name: true } } } }),
      prisma.contractorShift.findMany({ where: { organizationId, checkInAt: { gte: dayBounds(from).from, lte: dayBounds(to).to } }, select: { id: true, contractorId: true, checkInAt: true } }),
    ]);
    const recs = records.map((r) => ({ contractorId: r.contractorId, date: r.date.toISOString().slice(0, 10), present: r.present, notes: r.notes, project: r.project, shiftId: r.shiftId }));
    // check-in que não nasceu de um lançamento do escritório = o montador bateu o ponto
    const officeShiftIds = new Set(recs.map((r) => r.shiftId).filter(Boolean));
    const self = shifts.filter((s) => !officeShiftIds.has(s.id)).map((s) => ({ contractorId: s.contractorId, date: localDayOf(s.checkInAt) }));
    const totals = new Map(attendanceTotals(contractors.map((c) => c.id), days, recs, self).map((t) => [t.contractorId, t]));

    return ok(res, {
      from,
      to,
      days,
      today: localDayOf(new Date()),
      contractors: contractors.map((c) => ({ id: c.id, name: c.name, hasLogin: Boolean(c.userId), dailyRate: Number(c.dailyRate), ...totals.get(c.id) })),
      records: recs.map(({ shiftId: _s, ...r }) => r),
      selfCheckIns: self,
    });
  })
);

const mark = z.object({
  contractorId: z.string().min(1),
  date: day,
  present: z.boolean(),
  projectId: z.string().min(1).nullable().optional().or(z.literal("")),
  notes: z.string().trim().max(500).nullable().optional(),
});

async function contractorFor(id: string, organizationId: string) {
  const c = await prisma.contractor.findFirst({ where: { id, organizationId }, select: { id: true, name: true, dailyRate: true, active: true } });
  if (!c) throw new NotFoundError("Montador não encontrado");
  return c;
}

router.put(
  "/attendance",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const input = mark.parse(req.body);
    const organizationId = req.user!.organizationId;
    const c = await contractorFor(input.contractorId, organizationId);
    if (input.date > localDayOf(new Date())) throw new BadRequestError("Não dá para lançar presença de um dia que ainda não chegou");
    const projectId = input.projectId || null;
    if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } }))) throw new BadRequestError("Projeto inválido");

    const date = asDate(input.date);
    const existing = await prisma.contractorAttendance.findUnique({ where: { contractorId_date: { contractorId: c.id, date } } });
    let shiftId = existing?.shiftId ?? null;

    if (input.present) {
      if (!shiftId) {
        const b = dayBounds(input.date);
        const own = await prisma.contractorShift.findFirst({ where: { contractorId: c.id, checkInAt: { gte: b.from, lte: b.to } }, select: { id: true } });
        // o montador já bateu o ponto: o dia já conta, não precisa de outro turno
        if (!own) {
          const t = attendanceShiftTimes(input.date);
          const shift = await prisma.contractorShift.create({
            data: { organizationId, contractorId: c.id, projectId, checkInAt: t.checkInAt, checkOutAt: t.checkOutAt, minutes: t.minutes, dailyRate: c.dailyRate, notes: "Presença lançada pelo escritório", createdById: req.user!.id },
            select: { id: true },
          });
          shiftId = shift.id;
        }
      } else if (projectId !== (existing?.projectId ?? null)) {
        await prisma.contractorShift.update({ where: { id: shiftId }, data: { projectId } }).catch(() => undefined);
      }
    } else if (shiftId) {
      // só o turno criado por este lançamento
      await prisma.contractorShift.delete({ where: { id: shiftId } }).catch(() => undefined);
      shiftId = null;
    }

    const data = { present: input.present, projectId, notes: input.notes || null, shiftId };
    await prisma.contractorAttendance.upsert({
      where: { contractorId_date: { contractorId: c.id, date } },
      create: { organizationId, contractorId: c.id, date, createdById: req.user!.id, ...data },
      update: data,
    });
    return ok(res, { contractorId: c.id, date: input.date, present: input.present }, `${c.name}: ${input.present ? "veio" : "não veio"} em ${input.date.split("-").reverse().join("/")}`);
  })
);

router.delete(
  "/attendance",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const input = z.object({ contractorId: z.string().min(1), date: day }).parse(req.body);
    const c = await contractorFor(input.contractorId, req.user!.organizationId);
    const existing = await prisma.contractorAttendance.findUnique({ where: { contractorId_date: { contractorId: c.id, date: asDate(input.date) } } });
    if (existing) {
      if (existing.shiftId) await prisma.contractorShift.delete({ where: { id: existing.shiftId } }).catch(() => undefined);
      await prisma.contractorAttendance.delete({ where: { id: existing.id } });
    }
    return ok(res, { contractorId: c.id, date: input.date, present: null }, "Lançamento removido");
  })
);

export default router;
