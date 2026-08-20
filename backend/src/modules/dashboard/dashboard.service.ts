import { MovementType, Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { daysAgo, num, previousMonthRange, startOfDay } from "../../utils/helpers";
import type { ChartPeriod } from "./dashboard.schema";

const PERIOD_DAYS: Record<ChartPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

const ENTRY_TYPES: MovementType[] = [MovementType.ENTRY, MovementType.RETURN];
const EXIT_TYPES: MovementType[] = [MovementType.EXIT, MovementType.LOSS, MovementType.DAMAGE];
const PHYSICAL_TYPES: MovementType[] = [...ENTRY_TYPES, ...EXIT_TYPES];

async function monthMovements(from: Date, to: Date) {
  const movements = await prisma.stockMovement.findMany({
    where: { date: { gte: from, lt: to }, type: { in: PHYSICAL_TYPES } },
    select: { type: true, quantity: true },
  });
  return movements.reduce(
    (acc, m) => {
      if (ENTRY_TYPES.includes(m.type)) acc.entries += m.quantity;
      else acc.exits += m.quantity;
      return acc;
    },
    { entries: 0, exits: 0 }
  );
}

export async function getDashboard() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prev = previousMonthRange();

  const [productAgg, alerts, current, prevMonth] = await Promise.all([
    prisma.product.aggregate({
      where: { status: "ACTIVE" },
      _sum: { stock: true },
      _count: true,
    }),
    prisma.product.count({ where: { status: "ACTIVE", stock: { lte: prisma.product.fields.minStock } } }),
    monthMovements(monthStart, now),
    monthMovements(prev.start, prev.end),
  ]);

  const recentMovements = await prisma.stockMovement.findMany({
    where: { type: { in: PHYSICAL_TYPES } },
    include: {
      product: { select: { id: true, name: true, code: true, unit: true } },
      responsible: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 8,
  });

  const entries = current.entries;
  const exits = current.exits;
  const prevEntries = prevMonth.entries;
  const prevExits = prevMonth.exits;

  const percent = (currentVal: number, previousVal: number): number | null => {
    if (previousVal === 0) return currentVal > 0 ? 100 : null;
    return Math.round(((currentVal - previousVal) / previousVal) * 100);
  };

  return {
    kpis: {
      totalItems: productAgg._count,
      totalStock: num(productAgg._sum.stock),
      entriesMonth: entries,
      exitsMonth: exits,
      alerts,
      previous: {
        entriesMonth: prevEntries,
        exitsMonth: prevExits,
        entriesChangePercent: percent(entries, prevEntries),
        exitsChangePercent: percent(exits, prevExits),
      },
    },
    balance: num(productAgg._sum.stock),
    recentMovements: recentMovements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      date: m.date,
      note: m.note,
      product: m.product,
      responsible: m.responsible,
    })),
  };
}

export async function getChart(period: ChartPeriod) {
  const days = PERIOD_DAYS[period];
  const start = daysAgo(days - 1);
  const today = startOfDay(new Date());

  const movements = await prisma.stockMovement.findMany({
    where: { date: { gte: start, lte: today }, type: { in: PHYSICAL_TYPES } },
    select: { type: true, quantity: true, date: true },
  });

  const labels: string[] = [];
  const entries: number[] = [];
  const exits: number[] = [];
  const balance: number[] = [];

  const entriesByDay = new Map<string, number>();
  const exitsByDay = new Map<string, number>();

  for (const m of movements) {
    const key = startOfDay(m.date).toISOString().slice(0, 10);
    const target = ENTRY_TYPES.includes(m.type) ? entriesByDay : exitsByDay;
    target.set(key, (target.get(key) ?? 0) + m.quantity);
  }

  let netInPeriod = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const e = entriesByDay.get(key) ?? 0;
    const x = exitsByDay.get(key) ?? 0;
    netInPeriod += e - x;
  }

  const totalStock = num((await prisma.product.aggregate({ where: { status: "ACTIVE" }, _sum: { stock: true } }))._sum.stock);
  const balanceAtStart = totalStock - netInPeriod;

  let running = balanceAtStart;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const e = entriesByDay.get(key) ?? 0;
    const x = exitsByDay.get(key) ?? 0;
    running += e - x;
    labels.push(d.toISOString().slice(0, 10));
    entries.push(e);
    exits.push(x);
    balance.push(running);
  }

  return { period, labels, entries, exits, balance, currentBalance: totalStock };
}
