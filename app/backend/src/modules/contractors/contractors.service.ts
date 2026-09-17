/**
 * Regras de cálculo dos montadores terceirizados (sem acesso a banco, para
 * poder testar isoladamente).
 */
import { InvalidQueryError, ValidationError } from "../../utils/ApiError";

/** Fortaleza é UTC-3 o ano todo (sem horário de verão). */
export const FORTALEZA_OFFSET = "-03:00";
const DAY_MS = 86400000;

/** Dia local de Fortaleza (aaaa-mm-dd) de um instante. */
export const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });

/**
 * Converte o período da tela (datas aaaa-mm-dd, em horário de Fortaleza) em
 * instantes UTC: do início do dia `from` até o último milissegundo do dia `to`.
 *
 * Cortar em UTC perderia o turno das 22h (01h UTC do dia seguinte) no último
 * dia e traria o das 21h da véspera no primeiro.
 */
export function localPeriod(from: unknown, to: unknown, defaultDays = 30, now = new Date()) {
  const parse = (v: unknown, edge: "start" | "end", name: string): Date | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const raw = String(Array.isArray(v) ? v[0] : v).trim();
    const time = edge === "start" ? "00:00:00.000" : "23:59:59.999";
    const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T${time}${FORTALEZA_OFFSET}`) : new Date(raw);
    if (Number.isNaN(d.getTime())) throw new InvalidQueryError(`Data inválida em ${name}: "${raw}"`, { param: name });
    return d;
  };

  const end = parse(to, "end", "to") ?? new Date(`${localDay(now)}T23:59:59.999${FORTALEZA_OFFSET}`);
  const start =
    parse(from, "start", "from") ??
    new Date(`${localDay(new Date(end.getTime() - (defaultDays - 1) * DAY_MS))}T00:00:00.000${FORTALEZA_OFFSET}`);
  if (start > end) throw new InvalidQueryError("A data inicial deve ser anterior à final", { from: start, to: end });
  return { from: start, to: end };
}

export type ShiftForSummary = {
  contractorId: string;
  contractorName: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  minutes: number | null;
  dailyRate: number;
};

export type ContractorSummaryItem = {
  contractorId: string;
  name: string;
  minutes: number;
  hours: number;
  days: number;
  openShifts: number;
  total: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fechamento: horas somadas e uma diária por dia trabalhado.
 * - dois turnos no mesmo dia (de Fortaleza) contam uma diária só;
 * - vale a diária congelada no turno; se o mesmo dia tiver diárias diferentes,
 *   usa a maior (não paga menos por causa de um reajuste no meio do dia);
 * - turno em aberto conta o dia, mas ainda não soma horas.
 */
export function summarizeShifts(shifts: ShiftForSummary[]) {
  const by = new Map<string, { name: string; minutes: number; days: Map<string, number>; open: number }>();

  for (const s of shifts) {
    const row = by.get(s.contractorId) ?? { name: s.contractorName, minutes: 0, days: new Map<string, number>(), open: 0 };
    row.minutes += s.minutes ?? 0;
    if (s.checkOutAt === null) row.open++;
    const day = localDay(s.checkInAt);
    row.days.set(day, Math.max(row.days.get(day) ?? 0, Number.isFinite(s.dailyRate) ? s.dailyRate : 0));
    by.set(s.contractorId, row);
  }

  const items: ContractorSummaryItem[] = [...by.entries()]
    .map(([contractorId, r]) => ({
      contractorId,
      name: r.name,
      minutes: r.minutes,
      hours: round2(r.minutes / 60),
      days: r.days.size,
      openShifts: r.open,
      total: round2([...r.days.values()].reduce((a, b) => a + b, 0)),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return {
    items,
    totals: {
      contractors: items.length,
      hours: round2(items.reduce((a, i) => a + i.hours, 0)),
      days: items.reduce((a, i) => a + i.days, 0),
      total: round2(items.reduce((a, i) => a + i.total, 0)),
      openShifts: items.reduce((a, i) => a + i.openShifts, 0),
    },
  };
}

/** Duração em minutos de um turno, validando a ordem das datas. */
export function shiftMinutes(checkInAt: Date, checkOutAt: Date) {
  if (checkOutAt <= checkInAt) throw new ValidationError("Check-out deve ser depois do check-in");
  return Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
}
