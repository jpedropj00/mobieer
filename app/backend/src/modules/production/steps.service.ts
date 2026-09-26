/**
 * §23/§24 — Etapas do pedido na fábrica: criação com prazo em cascata, reflexo
 * na esteira macro (ProductionOrder.stage) e os avisos de prazo.
 */
import type { ProductionStage, ProductionStepKey } from "@prisma/client";
import { prisma } from "../../prisma";
import { sendAutomation } from "../../lib/automations";
import { notifyUsersWithPermission } from "../../lib/notify";
import { STAGE_LABEL, STAGE_TIMESTAMP, stageIndex } from "./production.service";
import { STEP_LABEL, STEP_ORDER, parseStepDays, planDueDates, stepAlert } from "./steps.rules";

export const STEP_DAYS_SETTING = "production.stepDays";

export async function loadStepDays() {
  const row = await prisma.setting.findUnique({ where: { key: STEP_DAYS_SETTING } });
  return parseStepDays(row?.value);
}

/**
 * Etapas de fábrica que a esteira macro já deixou para trás. Usado só ao criar
 * as etapas de um pedido antigo, para não nascerem "pendentes" coisas que a
 * fábrica já fez.
 */
export function stepsDoneByStage(stage: ProductionStage): ProductionStepKey[] {
  if (stage === "PRE_ASSEMBLY") return STEP_ORDER.slice(0, STEP_ORDER.indexOf("PRE_MONTAGEM"));
  if (stage === "OUT_FOR_DELIVERY" || stage === "DELIVERED") return [...STEP_ORDER];
  return [];
}

/**
 * Garante as 9 etapas do pedido. Idempotente: só cria as que faltam e nunca
 * mexe em prazo já definido.
 *
 * Pedido novo (`fromRelease`): prazos em cascata a partir da liberação.
 * Pedido que já existia antes das etapas: a cascata parte de hoje e o que a
 * esteira já passou nasce concluído — senão todo pedido antigo apareceria
 * atrasado de uma vez e o job diário soltaria uma enxurrada de avisos falsos.
 */
export async function ensureSteps(orderId: string, opts: { fromRelease?: boolean } = {}) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    select: { id: true, stage: true, releasedAt: true, createdAt: true, steps: { select: { step: true } } },
  });
  if (!order) return;
  const existing = new Set(order.steps.map((s) => s.step));
  const missing = STEP_ORDER.filter((k) => !existing.has(k));
  if (!missing.length) return;
  const now = new Date();
  const done = new Set(opts.fromRelease ? [] : stepsDoneByStage(order.stage));
  const due = planDueDates(opts.fromRelease ? (order.releasedAt ?? order.createdAt) : now, await loadStepDays());
  await prisma.productionStep.createMany({
    data: missing.map((k) => ({
      orderId,
      step: k,
      position: STEP_ORDER.indexOf(k),
      dueAt: due[k],
      ...(done.has(k) ? { status: "DONE" as const, completedAt: now, notes: "Registrada como concluída: o pedido já tinha passado desta etapa." } : {}),
    })),
    skipDuplicates: true,
  });
}

/** Garante as etapas de todos os pedidos em aberto (pedidos criados antes deste recurso). */
export async function ensureStepsForOpenOrders(organizationId?: string) {
  const orders = await prisma.productionOrder.findMany({
    where: { stage: { not: "DELIVERED" }, ...(organizationId ? { organizationId } : {}), steps: { none: {} } },
    select: { id: true },
  });
  for (const o of orders) await ensureSteps(o.id);
  return orders.length;
}

/** Etapa da esteira macro que a etapa de fábrica implica ao iniciar/concluir. */
export function impliedStage(step: ProductionStepKey, event: "START" | "COMPLETE"): ProductionStage | null {
  if (step === "PLANO_CORTE" || step === "CORTE") return "IN_PRODUCTION";
  if (step === "PRE_MONTAGEM" && event === "START") return "PRE_ASSEMBLY";
  if (step === "SAIDA" && event === "COMPLETE") return "OUT_FOR_DELIVERY";
  return null;
}

/**
 * Leva a esteira macro adiante quando a fábrica anda. Só avança (nunca volta a
 * etapa que a equipe ajustou à mão) e nunca marca entregue — isso continua
 * manual, porque conclui o projeto.
 */
export async function syncOrderStage(orderId: string, target: ProductionStage | null, actorId: string, stepLabel: string) {
  if (!target) return false;
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { project: { select: { id: true, code: true, name: true, clientId: true } } },
  });
  if (!order || stageIndex(target) <= stageIndex(order.stage)) return false;
  const ts = STAGE_TIMESTAMP[target];
  await prisma.productionOrder.update({
    where: { id: order.id },
    data: {
      stage: target,
      ...(order[ts] ? {} : { [ts]: new Date() }),
      events: { create: { stage: target, note: `Automático: ${stepLabel}`, createdById: actorId } },
    },
  });
  void sendAutomation("PRODUCTION_STAGE", {
    organizationId: order.organizationId,
    clientId: order.project.clientId,
    vars: { "projeto.codigo": order.project.code, "projeto.nome": order.project.name, "producao.etapa": STAGE_LABEL[target] },
    dedupeKey: `production-stage:${order.id}:${target}`,
  });
  return true;
}

/** Avisa responsável e gerente do projeto; sem nenhum dos dois, quem gerencia a produção. */
export async function notifyStep(opts: {
  organizationId: string;
  responsibleId: string | null;
  managerId: string | null;
  title: string;
  message: string;
  excludeUserId?: string | null;
}) {
  const ids = [...new Set([opts.responsibleId, opts.managerId].filter((x): x is string => !!x && x !== opts.excludeUserId))];
  if (ids.length) {
    await prisma.notification.createMany({ data: ids.map((userId) => ({ type: "INFO" as const, title: opts.title, message: opts.message, userId })) });
    return ids.length;
  }
  return notifyUsersWithPermission({
    organizationId: opts.organizationId,
    permission: "production.steps",
    title: opts.title,
    message: opts.message,
    excludeUserId: opts.excludeUserId,
  });
}

/** Job diário: prazo de etapa próximo (<= 1 dia) ou vencido. */
export async function runProductionStepAlerts(now = new Date()) {
  await ensureStepsForOpenOrders();
  const steps = await prisma.productionStep.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
      dueAt: { not: null, lte: new Date(now.getTime() + 86_400_000) },
      order: { stage: { not: "DELIVERED" }, project: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
    },
    include: { order: { select: { organizationId: true, project: { select: { code: true, name: true, managerId: true } } } } },
  });
  let dueSoon = 0;
  let overdue = 0;
  for (const s of steps) {
    const kind = stepAlert(s, now);
    if (!kind) continue;
    const p = s.order.project;
    const data = s.dueAt!.toLocaleDateString("pt-BR");
    await notifyStep({
      organizationId: s.order.organizationId,
      responsibleId: s.responsibleId,
      managerId: p.managerId,
      title: kind === "OVERDUE" ? "Produção atrasada" : "Prazo de etapa próximo",
      message:
        kind === "OVERDUE"
          ? `${p.code} — ${p.name}: a etapa "${STEP_LABEL[s.step]}" venceu em ${data}${s.status === "BLOCKED" ? " e está bloqueada" : ""}.`
          : `${p.code} — ${p.name}: a etapa "${STEP_LABEL[s.step]}" vence em ${data}.`,
    });
    await prisma.productionStep.update({ where: { id: s.id }, data: { lastAlertKind: kind, lastAlertAt: now } });
    if (kind === "OVERDUE") overdue++;
    else dueSoon++;
  }
  return { dueSoon, overdue };
}
