/**
 * Painel da operação (a "sala de controle"): regras puras de período,
 * agrupamento no tempo e estimativa de chapas.
 */

export type Period = "today" | "7d" | "month" | "year";
export const PERIODS: Period[] = ["today", "7d", "month", "year"];

const TZ_OFFSET_H = 3; // loja em Fortaleza (UTC-3, sem horário de verão)

/** Dia (aaaa-mm-dd) no fuso da loja. */
export function localDay(d: Date) {
  return new Date(d.getTime() - TZ_OFFSET_H * 3_600_000).toISOString().slice(0, 10);
}

/** Início (inclusive) e fim (exclusivo) do período, em instantes UTC, e o tamanho do balde do gráfico. */
export function periodRange(p: Period, now = new Date()) {
  const today = localDay(now);
  const [y, m] = today.split("-").map(Number);
  const startOfDay = (day: string) => new Date(`${day}T00:00:00.000-03:00`);
  const addDays = (day: string, n: number) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const end = startOfDay(addDays(today, 1));
  if (p === "today") return { start: startOfDay(today), end, bucket: "day" as const, label: "Hoje" };
  if (p === "7d") return { start: startOfDay(addDays(today, -6)), end, bucket: "day" as const, label: "Últimos 7 dias" };
  if (p === "month") return { start: startOfDay(`${y}-${String(m).padStart(2, "0")}-01`), end, bucket: "day" as const, label: "Mês atual" };
  return { start: startOfDay(`${y}-01-01`), end, bucket: "month" as const, label: `Ano ${y}` };
}

/** Chaves dos baldes do gráfico, do início até hoje (dia) ou até o mês atual (mês). */
export function bucketKeys(start: Date, end: Date, bucket: "day" | "month") {
  const keys: string[] = [];
  const first = localDay(start);
  const last = localDay(new Date(end.getTime() - 1));
  if (bucket === "month") {
    let [y, m] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return keys;
  }
  for (let d = first; d <= last; ) {
    keys.push(d);
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    d = x.toISOString().slice(0, 10);
  }
  return keys;
}

export const bucketOf = (d: Date, bucket: "day" | "month") => (bucket === "month" ? localDay(d).slice(0, 7) : localDay(d));

/** Soma valores por balde; baldes sem movimento ficam em zero. */
export function series(keys: string[], rows: { at: Date; value: number }[], bucket: "day" | "month") {
  const map = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const k = bucketOf(r.at, bucket);
    if (map.has(k)) map.set(k, Math.round((map.get(k)! + r.value) * 100) / 100);
  }
  return keys.map((k) => ({ key: k, value: map.get(k)! }));
}

/** Chapa padrão de MDF 2750 × 1840 mm. */
export const SHEET_M2 = 2.75 * 1.84;
export const CUT_LOSS = 0.1;

/** Chapas necessárias para uma área de peças (m²), com a perda de corte. Arredonda para cima. */
export function sheetsFor(areaM2: number) {
  if (!(areaM2 > 0)) return 0;
  return Math.ceil((areaM2 * (1 + CUT_LOSS)) / SHEET_M2);
}

/** Produto de estoque que é chapa (pelo nome). */
export const isSheetProduct = (name: string) => /\b(chapa|mdf|mdp|compensado|osb|hdf)\b/i.test(name.normalize("NFD").replace(/[̀-ͯ]/g, ""));
