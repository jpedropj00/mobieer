/**
 * Prazos medidos (não chutados).
 *
 * A loja acompanha quanto tempo cada tipo de cômodo leva na fábrica e na
 * montagem e quanto um pedido leva da liberação à entrega. Com histórico
 * suficiente, o portal mostra ao cliente uma faixa de previsão
 * ("entre 18/10 e 25/10") baseada nos pedidos reais — mediana e percentil 80.
 */
import { prisma } from "../../prisma";
import { ROOM_LABEL, classifyRoom, median, percentile, type RoomTypeKey } from "../contractors/productivity.service";

const DAY_MS = 86400000;
/** Pedidos entregues necessários antes de mostrar previsão ao cliente. */
export const MIN_ORDERS_FOR_ESTIMATE = 3;
/** Janela de histórico considerada. */
export const LEADTIME_WINDOW_DAYS = 365;

const round1 = (n: number) => Math.round(n * 10) / 10;

export type DurationStats = { count: number; median: number | null; p80: number | null; min: number | null; max: number | null };

export function durationStats(values: number[]): DurationStats {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0);
  if (!v.length) return { count: 0, median: null, p80: null, min: null, max: null };
  return {
    count: v.length,
    median: round1(median(v)!),
    p80: round1(percentile(v, 80)!),
    min: round1(Math.min(...v)),
    max: round1(Math.max(...v)),
  };
}

export const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / DAY_MS;

/**
 * Faixa de entrega prevista a partir da liberação: [mediana, p80] dias.
 * Se a data provável já passou (pedido atrasado), a faixa anda para frente a
 * partir de hoje em vez de mostrar data no passado.
 */
export function estimateDeliveryWindow(releasedAt: Date, stats: DurationStats, now = new Date()) {
  if (stats.count < MIN_ORDERS_FOR_ESTIMATE || stats.median === null || stats.p80 === null) return null;
  let from = new Date(releasedAt.getTime() + stats.median * DAY_MS);
  let to = new Date(releasedAt.getTime() + Math.max(stats.p80, stats.median) * DAY_MS);
  let late = false;
  if (to < now) {
    late = true;
    const spread = Math.max(2, stats.p80 - stats.median);
    from = new Date(now.getTime() + DAY_MS);
    to = new Date(now.getTime() + spread * DAY_MS);
  } else if (from < now) {
    from = new Date(now.getTime() + DAY_MS);
  }
  return { from, to, basedOnOrders: stats.count, medianDays: stats.median, p80Days: stats.p80, late };
}

type ItemForRoom = { orderId: string; ambiente: string | null; status: string; startedAt: Date | null; completedAt: Date | null };

/**
 * Dias de fábrica por tipo de cômodo: para cada pedido, do primeiro item do
 * cômodo que entrou até o último que saiu. Só conta cômodos com tudo pronto.
 */
export function factoryDaysByRoom(items: ItemForRoom[]) {
  const groups = new Map<string, ItemForRoom[]>();
  for (const i of items) {
    if (i.status === "CANCELLED") continue;
    const key = `${i.orderId}|${classifyRoom(i.ambiente)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const byRoom = new Map<RoomTypeKey, number[]>();
  for (const [key, list] of groups) {
    if (list.some((i) => i.status !== "DONE" || !i.startedAt || !i.completedAt)) continue;
    const start = Math.min(...list.map((i) => i.startedAt!.getTime()));
    const end = Math.max(...list.map((i) => i.completedAt!.getTime()));
    const room = key.split("|")[1] as RoomTypeKey;
    byRoom.set(room, [...(byRoom.get(room) ?? []), (end - start) / DAY_MS]);
  }
  return [...byRoom.entries()]
    .map(([roomType, days]) => ({ roomType, label: ROOM_LABEL[roomType], ...durationStats(days) }))
    .sort((a, b) => b.count - a.count);
}

/** Estatística de pedidos entregues da organização (liberação -> entrega). */
export async function orderLeadTimeStats(organizationId: string, now = new Date()) {
  const orders = await prisma.productionOrder.findMany({
    where: {
      organizationId,
      stage: "DELIVERED",
      releasedAt: { not: null },
      deliveredAt: { not: null, gte: new Date(now.getTime() - LEADTIME_WINDOW_DAYS * DAY_MS) },
    },
    select: { id: true, releasedAt: true, outForDeliveryAt: true, deliveredAt: true },
  });
  const total = orders.map((o) => daysBetween(o.releasedAt!, o.deliveredAt!)).filter((d) => d >= 0);
  const factory = orders.filter((o) => o.outForDeliveryAt).map((o) => daysBetween(o.releasedAt!, o.outForDeliveryAt!)).filter((d) => d >= 0);
  const install = orders.filter((o) => o.outForDeliveryAt).map((o) => daysBetween(o.outForDeliveryAt!, o.deliveredAt!)).filter((d) => d >= 0);
  return { total: durationStats(total), factory: durationStats(factory), installation: durationStats(install), orderIds: orders.map((o) => o.id) };
}

/** Previsão para um pedido em andamento (null se não houver histórico suficiente). */
export async function deliveryEstimateFor(order: { organizationId: string; stage: string; releasedAt: Date | null }, now = new Date()) {
  if (order.stage === "DELIVERED" || !order.releasedAt) return null;
  const stats = await orderLeadTimeStats(order.organizationId, now);
  return estimateDeliveryWindow(order.releasedAt, stats.total, now);
}

/** Painel interno de prazos. */
export async function leadTimeDashboard(organizationId: string, now = new Date()) {
  const since = new Date(now.getTime() - LEADTIME_WINDOW_DAYS * DAY_MS);
  const [orders, items, tasks] = await Promise.all([
    orderLeadTimeStats(organizationId, now),
    prisma.productionItem.findMany({
      where: { organizationId, completedAt: { gte: since } },
      select: { orderId: true, ambiente: true, status: true, startedAt: true, completedAt: true },
    }),
    prisma.installationTask.findMany({
      where: { organizationId, status: "DONE", finishedAt: { gte: since } },
      select: { roomType: true, workedMinutes: true },
    }),
  ]);

  // itens do mesmo cômodo que ainda estão na fábrica invalidam o grupo: busca-os também
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  const openItems = orderIds.length
    ? await prisma.productionItem.findMany({
        where: { orderId: { in: orderIds }, status: { not: "DONE" } },
        select: { orderId: true, ambiente: true, status: true, startedAt: true, completedAt: true },
      })
    : [];

  const installByRoom = new Map<RoomTypeKey, number[]>();
  for (const t of tasks) installByRoom.set(t.roomType, [...(installByRoom.get(t.roomType) ?? []), t.workedMinutes / 60]);

  return {
    windowDays: LEADTIME_WINDOW_DAYS,
    minOrdersForEstimate: MIN_ORDERS_FOR_ESTIMATE,
    estimateAvailable: orders.total.count >= MIN_ORDERS_FOR_ESTIMATE,
    orders: { total: orders.total, factory: orders.factory, installation: orders.installation },
    factoryDaysByRoom: factoryDaysByRoom([...items, ...openItems]),
    installationHoursByRoom: [...installByRoom.entries()]
      .map(([roomType, hours]) => ({ roomType, label: ROOM_LABEL[roomType], ...durationStats(hours) }))
      .sort((a, b) => b.count - a.count),
  };
}
