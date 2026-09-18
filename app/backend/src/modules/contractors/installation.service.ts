/**
 * Montagem por cômodo: cronômetro (iniciar/pausar/concluir), validação da
 * gestão, meta própria congelada na conclusão e bônus na aprovação.
 */
import { Prisma, type InstallationTask, type RoomType } from "@prisma/client";
import { notifyUser, notifyUsersWithPermission } from "../../lib/notify";
import { prisma } from "../../prisma";
import { InvalidStateError, NotFoundError } from "../../utils/ApiError";
import {
  ROOM_LABEL,
  assertTaskTransition,
  evaluateBonus,
  logMinutes,
  normalizeTiers,
  ownTargetMinutes,
  type BonusTier,
} from "./productivity.service";

export const DEFAULT_TIERS: BonusTier[] = [
  { minGainPct: 10, amount: 30 },
  { minGainPct: 20, amount: 60 },
];

export async function getBonusPolicy(organizationId: string) {
  const row = await prisma.bonusPolicy.findUnique({ where: { organizationId } });
  let tiers: BonusTier[] = DEFAULT_TIERS;
  if (row && Array.isArray(row.tiers)) {
    try {
      tiers = normalizeTiers(row.tiers as BonusTier[]);
    } catch {
      tiers = DEFAULT_TIERS;
    }
  }
  return {
    enabled: row?.enabled ?? false,
    minSamples: row?.minSamples ?? 3,
    tiers,
    maxPerMonth: row?.maxPerMonth != null ? Number(row.maxPerMonth) : null,
    configured: Boolean(row),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Tempos (min) dos cômodos aprovados do montador naquele tipo, mais recentes primeiro. */
export async function approvedHistory(contractorId: string, roomType: RoomType, excludeTaskId?: string) {
  const rows = await prisma.installationTask.findMany({
    where: { contractorId, roomType, status: "DONE", review: "APPROVED", ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}) },
    orderBy: { finishedAt: "desc" },
    take: 20,
    select: { workedMinutes: true },
  });
  return rows.map((r) => r.workedMinutes);
}

export async function currentTarget(organizationId: string, contractorId: string, roomType: RoomType, excludeTaskId?: string) {
  const policy = await getBonusPolicy(organizationId);
  const history = await approvedHistory(contractorId, roomType, excludeTaskId);
  return { target: ownTargetMinutes(history, policy.minSamples), samples: history.length, minSamples: policy.minSamples };
}

export const taskInclude = {
  project: { select: { id: true, code: true, name: true, client: { select: { name: true } } } },
  contractor: { select: { id: true, name: true } },
  logs: { orderBy: { startedAt: "asc" as const } },
  bonus: { select: { id: true, amount: true, gainPct: true, status: true } },
} as const;

type TaskRow = InstallationTask & {
  project: { id: string; code: string; name: string; client: { name: string } };
  contractor: { id: string; name: string };
  logs: { id: string; startedAt: Date; endedAt: Date | null; minutes: number | null }[];
  bonus: { id: string; amount: Prisma.Decimal; gainPct: Prisma.Decimal; status: string } | null;
};

export function serializeTask(t: TaskRow, now = new Date()) {
  const open = t.logs.find((l) => !l.endedAt);
  const liveMinutes = t.workedMinutes + (open ? logMinutes(open, now) : 0);
  return {
    id: t.id,
    project: t.project,
    contractor: t.contractor,
    roomType: t.roomType,
    roomTypeLabel: ROOM_LABEL[t.roomType],
    roomLabel: t.roomLabel,
    status: t.status,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    workedMinutes: t.workedMinutes,
    liveMinutes,
    runningSince: open?.startedAt ?? null,
    targetMinutes: t.targetMinutes,
    gainPct:
      t.status === "DONE" && t.targetMinutes && t.workedMinutes > 0
        ? Math.round(((t.targetMinutes - t.workedMinutes) / t.targetMinutes) * 10000) / 100
        : null,
    review: t.review,
    reviewedAt: t.reviewedAt,
    reviewNotes: t.reviewNotes,
    notes: t.notes,
    bonus: t.bonus ? { id: t.bonus.id, amount: Number(t.bonus.amount), gainPct: Number(t.bonus.gainPct), status: t.bonus.status } : null,
    createdAt: t.createdAt,
  };
}

async function loadTask(where: Prisma.InstallationTaskWhereInput) {
  const t = await prisma.installationTask.findFirst({ where, include: taskInclude });
  if (!t) throw new NotFoundError("Cômodo não encontrado");
  return t;
}

/** Iniciar/retomar. Um montador trabalha em um cômodo por vez. */
export async function startTask(taskId: string, scope: Prisma.InstallationTaskWhereInput, now = new Date()) {
  const t = await loadTask({ id: taskId, ...scope });
  assertTaskTransition(t.status, "start");
  const running = await prisma.installationTask.findFirst({
    where: { contractorId: t.contractorId, status: "IN_PROGRESS", id: { not: t.id } },
    select: { roomLabel: true, roomType: true },
  });
  if (running) {
    throw new InvalidStateError(`Pause o cômodo em andamento (${running.roomLabel || ROOM_LABEL[running.roomType]}) antes de iniciar outro`);
  }
  await prisma.$transaction([
    prisma.installationTaskLog.create({ data: { taskId: t.id, startedAt: now } }),
    prisma.installationTask.update({ where: { id: t.id }, data: { status: "IN_PROGRESS", startedAt: t.startedAt ?? now } }),
  ]);
  return loadTask({ id: t.id });
}

async function closeOpenLog(taskId: string, now: Date) {
  const open = await prisma.installationTaskLog.findFirst({ where: { taskId, endedAt: null } });
  if (!open) return 0;
  const minutes = logMinutes(open, now);
  await prisma.installationTaskLog.update({ where: { id: open.id }, data: { endedAt: now, minutes } });
  return minutes;
}

export async function pauseTask(taskId: string, scope: Prisma.InstallationTaskWhereInput, now = new Date()) {
  const t = await loadTask({ id: taskId, ...scope });
  assertTaskTransition(t.status, "pause");
  const minutes = await closeOpenLog(t.id, now);
  await prisma.installationTask.update({ where: { id: t.id }, data: { status: "PAUSED", workedMinutes: { increment: minutes } } });
  return loadTask({ id: t.id });
}

/** Concluir: fecha o cronômetro, congela a meta própria e manda para validação. */
export async function finishTask(taskId: string, scope: Prisma.InstallationTaskWhereInput, notes?: string | null, now = new Date()) {
  const t = await loadTask({ id: taskId, ...scope });
  assertTaskTransition(t.status, "finish");
  const minutes = t.status === "IN_PROGRESS" ? await closeOpenLog(t.id, now) : 0;
  const { target } = await currentTarget(t.organizationId, t.contractorId, t.roomType, t.id);
  const done = await prisma.installationTask.update({
    where: { id: t.id },
    data: {
      status: "DONE",
      finishedAt: now,
      workedMinutes: { increment: minutes },
      targetMinutes: target,
      review: "PENDING",
      notes: notes === undefined ? undefined : notes,
    },
  });
  const hours = (done.workedMinutes / 60).toFixed(1).replace(".", ",");
  await notifyUsersWithPermission({
    organizationId: t.organizationId,
    permission: "hr.employees.manage",
    title: "Cômodo montado — validar",
    message: `${t.contractor.name} concluiu ${t.roomLabel || ROOM_LABEL[t.roomType]} em ${t.project.code} (${hours}h). Valide a montagem para liberar o bônus.`,
  });
  return loadTask({ id: t.id });
}

/** Validação da gestão. Aprovado + meta batida = bônus. */
export async function reviewTask(opts: {
  taskId: string;
  organizationId: string;
  reviewerId: string;
  decision: "APPROVED" | "REJECTED";
  notes?: string | null;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const t = await loadTask({ id: opts.taskId, organizationId: opts.organizationId });
  if (t.status !== "DONE") throw new InvalidStateError("Só dá para validar cômodo concluído");
  if (t.review !== "PENDING") throw new InvalidStateError("Este cômodo já foi validado");

  // Condicional: duas validações simultâneas não geram dois bônus.
  const claimed = await prisma.installationTask.updateMany({
    where: { id: t.id, status: "DONE", review: "PENDING" },
    data: { review: opts.decision, reviewedById: opts.reviewerId, reviewedAt: now, reviewNotes: opts.notes ?? null },
  });
  if (claimed.count === 0) throw new InvalidStateError("Este cômodo já foi validado");

  let bonus: { amount: number; gain: number | null; reason: string } = { amount: 0, gain: null, reason: "Montagem reprovada" };
  if (opts.decision === "APPROVED") {
    const policy = await getBonusPolicy(t.organizationId);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3));
    const already = await prisma.contractorBonus.aggregate({
      where: { contractorId: t.contractorId, status: { in: ["APPROVED", "PAID"] }, createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    bonus = evaluateBonus({
      policyEnabled: policy.enabled,
      tiers: policy.tiers,
      targetMinutes: t.targetMinutes,
      actualMinutes: t.workedMinutes,
      alreadyThisMonth: Number(already._sum.amount ?? 0),
      maxPerMonth: policy.maxPerMonth,
    });
    if (bonus.amount > 0 && t.targetMinutes && bonus.gain !== null) {
      await prisma.contractorBonus.create({
        data: {
          organizationId: t.organizationId,
          contractorId: t.contractorId,
          taskId: t.id,
          roomType: t.roomType,
          targetMinutes: t.targetMinutes,
          actualMinutes: t.workedMinutes,
          gainPct: new Prisma.Decimal(bonus.gain.toFixed(2)),
          amount: new Prisma.Decimal(bonus.amount.toFixed(2)),
          decidedById: opts.reviewerId,
        },
      });
    }
  }

  const contractor = await prisma.contractor.findUnique({ where: { id: t.contractorId }, select: { userId: true } });
  const room = t.roomLabel || ROOM_LABEL[t.roomType];
  await notifyUser(
    contractor?.userId,
    opts.decision === "APPROVED" ? "Cômodo aprovado" : "Cômodo precisa de ajuste",
    opts.decision === "APPROVED"
      ? `${room} (${t.project.code}) aprovado.${bonus.amount > 0 ? ` Bônus de R$ ${bonus.amount.toFixed(2).replace(".", ",")} por superar sua meta.` : ""}`
      : `${room} (${t.project.code}) não foi aprovado.${opts.notes ? ` Observação: ${opts.notes}` : ""}`
  );

  return { task: await loadTask({ id: t.id }), bonus };
}

/**
 * Liga/desliga o montador. Desativado:
 * - perde o login na hora (o usuário fica INACTIVE e toda requisição é recusada);
 * - o ponto aberto é fechado e o cômodo em andamento é pausado, para não
 *   continuar contando horas.
 * Reativado: o login volta a funcionar (se ele tinha acesso).
 */
export async function setContractorActive(contractorId: string, active: boolean, now = new Date()) {
  const c = await prisma.contractor.findUnique({ where: { id: contractorId }, select: { id: true, userId: true } });
  if (!c) throw new NotFoundError("Montador não encontrado");

  if (!active) {
    const running = await prisma.installationTask.findMany({ where: { contractorId: c.id, status: "IN_PROGRESS" }, select: { id: true } });
    for (const t of running) {
      const minutes = await closeOpenLog(t.id, now);
      await prisma.installationTask.update({ where: { id: t.id }, data: { status: "PAUSED", workedMinutes: { increment: minutes } } });
    }
    const open = await prisma.contractorShift.findMany({ where: { contractorId: c.id, checkOutAt: null } });
    for (const sh of open) {
      const minutes = Math.max(0, Math.round((now.getTime() - sh.checkInAt.getTime()) / 60000));
      await prisma.contractorShift.update({
        where: { id: sh.id },
        data: { checkOutAt: now, minutes, notes: [sh.notes, "Encerrado automaticamente: montador desativado"].filter(Boolean).join(" · ") },
      });
    }
  }

  await prisma.contractor.update({ where: { id: c.id }, data: { active } });
  if (c.userId) await prisma.user.update({ where: { id: c.userId }, data: { status: active ? "ACTIVE" : "INACTIVE" } });
  return { hadAccess: Boolean(c.userId) };
}
