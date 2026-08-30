import { prisma } from "../../prisma";

const DAY = 24 * 60 * 60 * 1000;

export async function nextRegistration(organizationId: string) {
  const count = await prisma.employee.count({ where: { organizationId } });
  for (let n = count + 1; n < count + 2000; n++) {
    const registration = `EMP-${String(n).padStart(4, "0")}`;
    if (!(await prisma.employee.findFirst({ where: { organizationId, registration }, select: { id: true } }))) {
      return registration;
    }
  }
  return `EMP-${Date.now()}`;
}

/** Conta dias de férias (calendário, inclusivo). */
export function countVacationDays(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
}

export type HrAlert = {
  kind: "CONCESSION_EXPIRING" | "CONCESSION_OVERDUE" | "TEAM_COLLISION";
  severity: "HIGH" | "MEDIUM";
  employeeId?: string;
  employeeName?: string;
  message: string;
  dueAt?: string;
};

export async function computeHrAlerts(organizationId: string): Promise<HrAlert[]> {
  const now = new Date();
  const alerts: HrAlert[] = [];

  const periods = await prisma.vacationPeriod.findMany({
    where: {
      status: { not: "CONCLUDED" },
      employee: { organizationId, status: { not: "TERMINATED" } },
    },
    include: { employee: { select: { id: true, fullName: true } } },
  });

  for (const p of periods) {
    const remaining = p.daysEntitled - p.daysTaken;
    if (remaining <= 0) continue;
    const daysToLimit = Math.ceil((p.concessionLimit.getTime() - now.getTime()) / DAY);
    if (daysToLimit < 0) {
      alerts.push({
        kind: "CONCESSION_OVERDUE",
        severity: "HIGH",
        employeeId: p.employee.id,
        employeeName: p.employee.fullName,
        dueAt: p.concessionLimit.toISOString(),
        message: `${p.employee.fullName}: período concessivo vencido há ${Math.abs(daysToLimit)} dia(s) — risco de férias em dobro (${remaining} dia(s) não usufruídos).`,
      });
    } else if (daysToLimit <= 60) {
      alerts.push({
        kind: "CONCESSION_EXPIRING",
        severity: daysToLimit <= 30 ? "HIGH" : "MEDIUM",
        employeeId: p.employee.id,
        employeeName: p.employee.fullName,
        dueAt: p.concessionLimit.toISOString(),
        message: `${p.employee.fullName}: ${remaining} dia(s) de férias a usufruir até ${p.concessionLimit.toLocaleDateString("pt-BR")} (${daysToLimit} dia(s)).`,
      });
    }
  }

  // Colisão de férias no mesmo setor
  const upcoming = await prisma.vacationRequest.findMany({
    where: {
      status: { in: ["APPROVED", "SCHEDULED"] },
      endDate: { gte: now },
      employee: { organizationId },
    },
    include: { employee: { select: { id: true, fullName: true, sector: true } } },
    orderBy: { startDate: "asc" },
  });
  for (let i = 0; i < upcoming.length; i++) {
    for (let j = i + 1; j < upcoming.length; j++) {
      const a = upcoming[i];
      const b = upcoming[j];
      const sector = a.employee.sector;
      if (!sector || sector !== b.employee.sector) continue;
      if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
        alerts.push({
          kind: "TEAM_COLLISION",
          severity: "MEDIUM",
          message: `Sobreposição de férias no setor ${sector}: ${a.employee.fullName} e ${b.employee.fullName}.`,
          dueAt: (a.startDate > b.startDate ? a.startDate : b.startDate).toISOString(),
        });
      }
    }
  }

  return alerts;
}

/** Job diário: transforma os alertas de RH em notificações para quem tem hr.read. */
export async function runVacationAlerts() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    const alerts = await computeHrAlerts(org.id);
    if (alerts.length === 0) continue;

    const recipients = await prisma.user.findMany({
      where: {
        organizationId: org.id,
        status: "ACTIVE",
        role: { permissions: { some: { permission: { code: "hr.read" } } } },
      },
      select: { id: true },
    });
    if (recipients.length === 0) continue;

    const high = alerts.filter((a) => a.severity === "HIGH").length;
    const title = "Alertas de férias";
    const message =
      `${alerts.length} alerta(s) de férias` +
      (high ? ` (${high} urgente(s))` : "") +
      `. Ex.: ${alerts[0].message}`;

    for (const r of recipients) {
      const recent = await prisma.notification.findFirst({
        where: { userId: r.id, type: "INFO", title, createdAt: { gte: new Date(Date.now() - DAY) } },
        select: { id: true },
      });
      if (recent) continue;
      await prisma.notification.create({ data: { type: "INFO", title, message, userId: r.id } });
    }
  }
}
