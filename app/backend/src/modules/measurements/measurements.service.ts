import { prisma } from "../../prisma";
import { PayloadTooLargeError, UnsupportedFileTypeError, ValidationError } from "../../utils/ApiError";

const DAY = 86400000;

/** Prazo do projeto técnico após a medição (dias corridos). */
export const TECH_PROJECT_DAYS = 12;

export const MEASUREMENT_PERIODS = ["MANHA", "TARDE", "QUALQUER"] as const;
export type MeasurementPeriod = (typeof MEASUREMENT_PERIODS)[number];
export const PERIOD_LABEL: Record<string, string> = { MANHA: "Manhã", TARDE: "Tarde", QUALQUER: "Qualquer horário" };

/** Tamanho máximo do desenho (PNG do canvas). */
export const MAX_DRAWING_BYTES = 12 * 1024 * 1024;

/**
 * PNG/JPEG/WebP em dataURL vindo do canvas do tablet -> Buffer.
 * Qualquer outro tipo (ex.: HTML/SVG disfarçado) é recusado.
 */
export function decodeDrawingDataUrl(dataUrl: string): { buffer: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" } {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl.trim());
  if (!m) throw new ValidationError("Desenho inválido: esperado uma imagem em base64 (data URL)");
  const mimeType = m[1].toLowerCase();
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    throw new UnsupportedFileTypeError("Desenho deve ser PNG, JPEG ou WebP", { received: mimeType });
  }
  // tamanho estimado antes de decodificar, para não alocar um buffer gigante
  const b64 = m[2].replace(/\s/g, "");
  if (Math.floor((b64.length * 3) / 4) > MAX_DRAWING_BYTES) throw new PayloadTooLargeError("Desenho muito grande (máx. 12 MB)");
  const buffer = Buffer.from(b64, "base64");
  if (!buffer.length) throw new ValidationError("Desenho vazio");
  return { buffer, mimeType };
}

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
  project: { select: { id: true, code: true, name: true, managerId: true, clientId: true, client: { select: { name: true } } } },
} as const;

/**
 * Job diário: cobra o projeto técnico quando o prazo de 12 dias está perto de
 * vencer (<= 3 dias) ou já venceu. Notifica o responsável pelo projeto e o
 * técnico que fez a medição (quando houver).
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
    if (v.project.status === "COMPLETED" || v.project.status === "CANCELLED") continue;
    const overdue = v.techProjectDueAt! < now;
    const message = overdue
      ? `${v.project.code} — ${v.project.name}: o prazo de ${TECH_PROJECT_DAYS} dias do projeto técnico venceu em ${v.techProjectDueAt!.toLocaleDateString("pt-BR")}.`
      : `${v.project.code} — ${v.project.name}: o projeto técnico vence em ${v.techProjectDueAt!.toLocaleDateString("pt-BR")}.`;

    const recipients = new Set([v.project.managerId, v.technicianId].filter((id): id is string => Boolean(id)));
    for (const userId of recipients) {
      const recent = await prisma.notification.findFirst({
        where: { userId, type: "INFO", title: "Prazo do projeto técnico", createdAt: { gte: new Date(now.getTime() - DAY) } },
        select: { id: true },
      });
      if (recent) continue;
      await prisma.notification.create({ data: { type: "INFO", title: "Prazo do projeto técnico", message, userId } });
      created++;
    }
  }
  return { alerted: created };
}
