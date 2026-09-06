import { prisma } from "../../prisma";

const DAY = 86400000;

/** Etapas da esteira de produção, em ordem. */
export const PRODUCTION_STAGES = [
  "RELEASED",
  "IN_PRODUCTION",
  "PRE_ASSEMBLY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const STAGE_LABEL: Record<ProductionStage, string> = {
  RELEASED: "Liberado para produção",
  IN_PRODUCTION: "Em produção",
  PRE_ASSEMBLY: "Pré-montagem",
  OUT_FOR_DELIVERY: "Em entrega e montagem",
  DELIVERED: "Entregue",
};

/** Campo de data preenchido quando o pedido entra em cada etapa. */
export const STAGE_TIMESTAMP: Record<ProductionStage, keyof StageTimestamps> = {
  RELEASED: "releasedAt",
  IN_PRODUCTION: "productionStartedAt",
  PRE_ASSEMBLY: "preAssemblyAt",
  OUT_FOR_DELIVERY: "outForDeliveryAt",
  DELIVERED: "deliveredAt",
};
type StageTimestamps = {
  releasedAt: Date | null;
  productionStartedAt: Date | null;
  preAssemblyAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
};

export function stageIndex(stage: string) {
  return PRODUCTION_STAGES.indexOf(stage as ProductionStage);
}
export function nextStage(stage: string): ProductionStage | null {
  const i = stageIndex(stage);
  return i >= 0 && i < PRODUCTION_STAGES.length - 1 ? PRODUCTION_STAGES[i + 1] : null;
}

export const orderInclude = {
  events: {
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
  },
  project: { select: { id: true, code: true, name: true, managerId: true, status: true, client: { select: { name: true } } } },
} as const;

type OrderRow = StageTimestamps & {
  id: string;
  stage: string;
  estimatedDeliveryAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  events?: {
    id: string;
    stage: string;
    note: string | null;
    createdAt: Date;
    createdBy?: { id: string; name: string } | null;
  }[];
  project?: {
    id: string;
    code: string;
    name: string;
    managerId: string | null;
    status?: string;
    client?: { name: string } | null;
  } | null;
};

export function serializeOrder(o: OrderRow) {
  const now = Date.now();
  const done = o.stage === "DELIVERED";
  const daysToEstimatedDelivery =
    o.estimatedDeliveryAt && !done ? Math.ceil((o.estimatedDeliveryAt.getTime() - now) / DAY) : null;
  return {
    id: o.id,
    stage: o.stage,
    stageLabel: STAGE_LABEL[o.stage as ProductionStage] ?? o.stage,
    stageIndex: stageIndex(o.stage),
    nextStage: nextStage(o.stage),
    releasedAt: o.releasedAt,
    productionStartedAt: o.productionStartedAt,
    preAssemblyAt: o.preAssemblyAt,
    outForDeliveryAt: o.outForDeliveryAt,
    deliveredAt: o.deliveredAt,
    estimatedDeliveryAt: o.estimatedDeliveryAt,
    daysToEstimatedDelivery,
    notes: o.notes,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    timeline: PRODUCTION_STAGES.map((s) => ({
      stage: s,
      label: STAGE_LABEL[s],
      reachedAt: (o[STAGE_TIMESTAMP[s]] as Date | null) ?? null,
      current: o.stage === s,
      done: stageIndex(o.stage) > stageIndex(s) || (done && s === "DELIVERED"),
    })),
    events:
      o.events?.map((e) => ({
        id: e.id,
        stage: e.stage,
        stageLabel: STAGE_LABEL[e.stage as ProductionStage] ?? e.stage,
        note: e.note,
        createdAt: e.createdAt,
        author: e.createdBy?.name ?? null,
      })) ?? [],
    project: o.project
      ? { id: o.project.id, code: o.project.code, name: o.project.name, clientName: o.project.client?.name ?? null }
      : undefined,
  };
}

/**
 * Cria a ordem de produção do projeto (etapa RELEASED) se ainda não existir.
 * Chamado quando o cliente aprova o projeto técnico e também pela tela interna.
 */
export async function getOrCreateOrder(projectId: string, organizationId: string, createdById?: string | null) {
  const existing = await prisma.productionOrder.findUnique({ where: { projectId }, include: orderInclude });
  if (existing) return existing;
  const now = new Date();
  await prisma.productionOrder.create({
    data: {
      organizationId,
      projectId,
      stage: "RELEASED",
      releasedAt: now,
      events: { create: { stage: "RELEASED", note: "Projeto liberado para produção", createdById: createdById ?? null } },
    },
  });
  return prisma.productionOrder.findUniqueOrThrow({ where: { projectId }, include: orderInclude });
}

/**
 * Job diário: cobra o responsável quando a previsão de entrega está a <= 3 dias
 * ou já passou e o pedido ainda não foi entregue. Dedup por 24h.
 */
export async function runProductionDeliveryAlerts() {
  const now = new Date();
  const soon = new Date(now.getTime() + 3 * DAY);
  const orders = await prisma.productionOrder.findMany({
    where: { stage: { not: "DELIVERED" }, estimatedDeliveryAt: { not: null, lte: soon } },
    include: { project: { select: { id: true, code: true, name: true, managerId: true, status: true } } },
  });

  let created = 0;
  for (const o of orders) {
    const mgr = o.project.managerId;
    if (!mgr) continue;
    if (o.project.status === "COMPLETED" || o.project.status === "CANCELLED") continue;
    const overdue = o.estimatedDeliveryAt! < now;
    const recent = await prisma.notification.findFirst({
      where: {
        userId: mgr,
        type: "INFO",
        title: "Previsão de entrega",
        createdAt: { gte: new Date(now.getTime() - DAY) },
      },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.notification.create({
      data: {
        type: "INFO",
        title: "Previsão de entrega",
        message: overdue
          ? `${o.project.code} — ${o.project.name}: a previsão de entrega (${o.estimatedDeliveryAt!.toLocaleDateString("pt-BR")}) passou e o pedido está em "${STAGE_LABEL[o.stage as ProductionStage]}".`
          : `${o.project.code} — ${o.project.name}: entrega prevista para ${o.estimatedDeliveryAt!.toLocaleDateString("pt-BR")} — etapa atual "${STAGE_LABEL[o.stage as ProductionStage]}".`,
        userId: mgr,
      },
    });
    created++;
  }
  return { alerted: created };
}
