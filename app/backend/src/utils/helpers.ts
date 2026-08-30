export function pad(n: number, length = 5) {
  return String(n).padStart(length, "0");
}

export async function nextCode(model: "product" | "requisition", prefix: string) {
  const prisma = (await import("../prisma")).prisma;
  if (model === "product") {
    const last = await prisma.product.findFirst({
      orderBy: { code: "desc" },
      select: { code: true },
    });
    const num = last ? parseInt(last.code.replace(/\D/g, ""), 10) + 1 : 1;
    return `${prefix}-${pad(num)}`;
  }
  const last = await prisma.requisition.findFirst({
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const num = last ? parseInt(last.number.replace(/\D/g, ""), 10) + 1 : 1;
  return `${prefix}-${pad(num)}`;
}

export function toDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function previousMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end };
}
