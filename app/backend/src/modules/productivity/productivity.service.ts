/**
 * §5 — Coleta dos dados reais do mês para os indicadores. Cada fonte é lida
 * uma vez para a equipe inteira e depois separada por pessoa.
 */
import { prisma } from "../../prisma";
import { buildMirror, computeHourBank } from "../hr/timeclock.service";
import type { MonthRange, RawUserMonth } from "./productivity.rules";

const empty = (): RawUserMonth => ({ activities: [], timeLogs: [], stepsCompleted: 0, tasks: [], clock: null });

export async function loadMonth(organizationId: string, range: MonthRange, userIds: string[], now = new Date()) {
  const inMonth = { gte: range.start, lt: range.end };
  const [activities, timeLogs, steps, tasks, employees] = await Promise.all([
    prisma.activity.findMany({
      where: { organizationId, employeeId: { in: userIds }, date: inMonth, status: { not: "CANCELLED" } },
      select: { employeeId: true, status: true, startTime: true, endTime: true },
    }),
    prisma.productionTimeLog.findMany({
      where: { organizationId, userId: { in: userIds }, startedAt: inMonth },
      select: { userId: true, minutes: true, itemId: true, sector: true },
    }),
    prisma.productionItemEvent.groupBy({
      by: ["createdById"],
      where: { action: "COMPLETE", createdById: { in: userIds }, createdAt: inMonth, item: { organizationId } },
      _count: { _all: true },
    }),
    // tarefas concluídas no mês + abertas com prazo até o fim do mês
    prisma.kanbanTask.findMany({
      where: {
        assigneeId: { in: userIds },
        column: { board: { organizationId } },
        OR: [{ completedAt: inMonth }, { completedAt: null, dueAt: { lt: range.end } }],
      },
      select: { assigneeId: true, dueAt: true, completedAt: true },
    }),
    prisma.employee.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { id: true, userId: true, weeklyHours: true },
    }),
  ]);

  const out = new Map<string, RawUserMonth>(userIds.map((id) => [id, empty()]));
  for (const a of activities) out.get(a.employeeId)?.activities.push(a);
  for (const l of timeLogs) out.get(l.userId)?.timeLogs.push(l);
  for (const s of steps) if (s.createdById) out.get(s.createdById)!.stepsCompleted = s._count._all;
  for (const t of tasks) if (t.assigneeId) out.get(t.assigneeId)?.tasks.push(t);

  if (employees.length) {
    const entries = await prisma.timeEntry.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) }, timestamp: inMonth },
      select: { employeeId: true, timestamp: true, kind: true },
    });
    // dia que ainda não chegou não é falta
    const hoje = now.toISOString().slice(0, 10);
    for (const e of employees) {
      const mine = entries.filter((x) => x.employeeId === e.id);
      const days = buildMirror(mine, range.month, e.weeklyHours).days.filter((d) => d.date <= hoje);
      const bank = computeHourBank(days, []);
      // sem nenhuma marcação no mês, o ponto não foi importado: não é "N faltas"
      out.get(e.userId!)!.clock = mine.length
        ? { workedMinutes: bank.workedMinutes, overtimeMinutes: bank.overtimeMinutes, faltas: bank.faltas }
        : null;
    }
  }
  return out;
}
