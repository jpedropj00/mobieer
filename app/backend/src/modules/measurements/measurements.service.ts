import { prisma } from "../../prisma";

const DAY = 86400000;

/** Prazo do projeto técnico após a medição (dias corridos). */
export const TECH_PROJECT_DAYS = 12;

export const MEASUREMENT_PERIODS = ["MANHA", "TARDE", "QUALQUER"] as const;
export type MeasurementPeriod = (typeof MEASUREMENT_PERIODS)[number];
export const PERIOD_LABEL: Record<string, string> = { MANHA: "Manhã", TARDE: "Tarde", QUALQUER: "Qualquer horário" };

export function techProjectDueDate(from: Date) {
  return new Date(from.getTime() + TECH_PROJECT_DAYS * DAY);
}

type VisitRow = {
  id: string;
  status: string;
  preferredDates: string[];
  preferredPeriod: string | null;
  clientNotes: string | null;
  scheduledAt: Date | null;
  teamNotes: string | null;
  doneAt: Date | null;
  techProjectDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  technician?: { id: string; name: string } | null;
  project?: { id: string; code: string; name: string; managerId: string | null; client?: { name: string } | null } | null;
};

export function serializeVisit(v: VisitRow) {
  const now = Date.now();
  const daysToTechDeadline =
    v.techProjectDueAt && v.status === "DONE" ? Math.ceil((v.techProjectDueAt.getTime() - now) / DAY) : null;
  return {
    id: v.id,
    status: v.status,
    preferredDates: v.preferredDates,
    preferredPeriod: v.preferredPeriod,
    clientNotes: v.clientNotes,
    scheduledAt: v.scheduledAt,
    teamNotes: v.teamNotes,
    doneAt: v.doneAt,
    techProjectDueAt: v.techProjectDueAt,
    daysToTechDeadline,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    technician: v.technician ?? null,
    project: v.project
      ? { id: v.project.id, code: v.project.code, name: v.project.name, clientName: v.project.client?.name ?? null }
      : undefined,
  };
}

export const visitInclude = {
  technician: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true, managerId: true, client: { select: { name: true } } } },
} as const;

/**
 * Job diário: cobra o projeto técnico quando o prazo de 12 dias está perto de
 * vencer (<= 3 dias) ou já venceu. Notifica o responsável pelo projeto.
 */
export async function runMeasurementDeadlineAlerts() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * DAY);
  const visits = await prisma.measurementVisit.findMany({
    where: { status: "DONE", techProjectDueAt: { not: null, lte: soon } },
    include: { project: { select: { id: true, code: true, name: true, managerId: true, status: true } } },
  });

  let created = 0;
  for (const v of visits) {
    const mgr = v.project.managerId;
    if (!mgr) continue;
    if (v.project.status === "COMPLETED" || v.project.status === "CANCELLED") continue;
    const overdue = v.techProjectDueAt! < now;
    const recent = await prisma.notification.findFirst({
      where: {
        userId: mgr,
        type: "INFO",
        title: "Prazo do projeto técnico",
        createdAt: { gte: new Date(now.getTime() - DAY) },
      },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.notification.create({
      data: {
        type: "INFO",
        title: "Prazo do projeto técnico",
        message: overdue
          ? `${v.project.code} — ${v.project.name}: o prazo de ${TECH_PROJECT_DAYS} dias do projeto técnico venceu em ${v.techProjectDueAt!.toLocaleDateString("pt-BR")}.`
          : `${v.project.code} — ${v.project.name}: o projeto técnico vence em ${v.techProjectDueAt!.toLocaleDateString("pt-BR")}.`,
        userId: mgr,
      },
    });
    created++;
  }
  return { alerted: created };
}
