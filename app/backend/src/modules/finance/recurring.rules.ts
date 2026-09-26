/**
 * Despesas (e receitas) fixas: um modelo gera as parcelas mês a mês no
 * financeiro. Vencimento no dia escolhido — dia 31 vira o último dia em meses
 * mais curtos. Cada mês só é lançado uma vez (recurringId + mês).
 */

export type RecurringTemplate = {
  dayOfMonth: number;
  /** "AAAA-MM" do primeiro mês */
  startMonth: string;
  /** "AAAA-MM" do último mês, ou null = sem fim */
  endMonth: string | null;
};

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function addMonthKey(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthKey(d);
}

/** Vencimento (aaaa-mm-dd) do mês, ajustando o dia ao tamanho do mês. */
export function dueDayOf(month: string, dayOfMonth: number) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, dayOfMonth), last)).padStart(2, "0")}`;
}

/**
 * Meses a lançar a partir de `fromMonth` (inclusive), no máximo `count`,
 * respeitando início/fim do modelo e pulando os que já existem.
 */
export function monthsToGenerate(t: RecurringTemplate, fromMonth: string, count: number, existing: Set<string>) {
  const out: { month: string; dueDay: string }[] = [];
  let m = fromMonth < t.startMonth ? t.startMonth : fromMonth;
  for (let i = 0; i < count; i++, m = addMonthKey(m, 1)) {
    if (t.endMonth && m > t.endMonth) break;
    if (!existing.has(m)) out.push({ month: m, dueDay: dueDayOf(m, t.dayOfMonth) });
  }
  return out;
}
