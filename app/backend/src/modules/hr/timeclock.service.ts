import type { TimeEntryKind } from "@prisma/client";

/**
 * Parser tolerante para arquivos de relógio de ponto.
 * Alvo: exportação do KNUP KP-1028 (por pendrive, "abre no Excel").
 * Aceita CSV/TXT com separador ; , ou TAB e colunas em qualquer ordem:
 *   matrícula/PIS, data (dd/mm/aaaa ou aaaa-mm-dd), hora (HH:MM[:SS])
 * ou uma coluna de data-hora combinada. Linhas inválidas são contadas, não quebram o import.
 */

export type ParsedPunch = { registration: string; timestamp: Date };
export type ParseResult = { punches: ParsedPunch[]; errors: number; total: number };

const DATE_RE = /(\d{2})[/.-](\d{2})[/.-](\d{4})|(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;

function toDate(dateStr: string, timeStr: string): Date | null {
  const dm = dateStr.match(DATE_RE);
  const tm = timeStr.match(TIME_RE);
  if (!dm || !tm) return null;
  let y: number, mo: number, d: number;
  if (dm[1]) {
    d = +dm[1];
    mo = +dm[2];
    y = +dm[3];
  } else {
    y = +dm[4];
    mo = +dm[5];
    d = +dm[6];
  }
  const hh = +tm[1];
  const mi = +tm[2];
  const ss = tm[3] ? +tm[3] : 0;
  const date = new Date(y, mo - 1, d, hh, mi, ss);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTimeClockFile(buffer: Buffer): ParseResult {
  let text = buffer.toString("utf8");
  if (text.includes("�")) text = buffer.toString("latin1");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const punches: ParsedPunch[] = [];
  let errors = 0;
  let total = 0;

  for (const line of lines) {
    // ignora cabeçalhos óbvios
    if (/matr[íi]cula|nome|pis|data.*hora|relat[óo]rio|empresa/i.test(line) && !DATE_RE.test(line)) continue;

    const cols = line.split(/[;\t,]/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    total++;

    // matrícula: primeiro token só de dígitos (2–20 chars)
    const reg = cols.find((c) => /^\d{1,20}$/.test(c) && !TIME_RE.test(c) && !DATE_RE.test(c));
    // data e hora podem estar juntas ou separadas
    const dateCol = cols.find((c) => DATE_RE.test(c));
    const timeCol = cols.find((c) => TIME_RE.test(c) && c !== dateCol) ?? dateCol;

    if (!reg || !dateCol || !timeCol) {
      errors++;
      continue;
    }
    const ts = toDate(dateCol, timeCol);
    if (!ts) {
      errors++;
      continue;
    }
    punches.push({ registration: reg, timestamp: ts });
  }

  return { punches, errors, total };
}

/** Alterna IN/OUT pela ordem cronológica das marcações do dia. */
export function inferKinds(sorted: Date[]): TimeEntryKind[] {
  return sorted.map((_, i) => {
    const inCycle = i % 4;
    if (inCycle === 0) return "IN";
    if (inCycle === 1) return "BREAK_OUT";
    if (inCycle === 2) return "BREAK_IN";
    return "OUT";
  });
}

export type DayMirror = {
  date: string; // YYYY-MM-DD
  weekday: number;
  punches: { time: string; kind: TimeEntryKind }[];
  workedMinutes: number;
  expectedMinutes: number;
  balanceMinutes: number;
  status: "OK" | "INCOMPLETO" | "FALTA" | "FOLGA";
};

/** Monta o espelho de ponto do mês a partir das marcações. */
export function buildMirror(
  entries: { timestamp: Date; kind: TimeEntryKind }[],
  month: string, // YYYY-MM
  weeklyHours: number
): { days: DayMirror[]; totalWorked: number; totalExpected: number; balance: number; faltas: number } {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dailyExpected = Math.round((weeklyHours / 5) * 60); // min, dias úteis

  const byDay = new Map<string, { timestamp: Date; kind: TimeEntryKind }[]>();
  for (const e of entries) {
    const key = e.timestamp.toISOString().slice(0, 10);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }

  const days: DayMirror[] = [];
  let totalWorked = 0;
  let totalExpected = 0;
  let faltas = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, m - 1, d);
    const key = dt.toISOString().slice(0, 10);
    const weekday = dt.getDay(); // 0 dom ... 6 sáb
    const isBusinessDay = weekday >= 1 && weekday <= 5;
    const expected = isBusinessDay ? dailyExpected : 0;

    const list = (byDay.get(key) ?? []).slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let worked = 0;
    for (let i = 0; i + 1 < list.length; i += 2) {
      worked += Math.max(0, (list[i + 1].timestamp.getTime() - list[i].timestamp.getTime()) / 60000);
    }
    worked = Math.round(worked);

    let status: DayMirror["status"];
    if (!isBusinessDay && list.length === 0) status = "FOLGA";
    else if (list.length === 0) {
      status = "FALTA";
      faltas++;
    } else if (list.length % 2 !== 0) status = "INCOMPLETO";
    else status = "OK";

    totalWorked += worked;
    totalExpected += expected;

    days.push({
      date: key,
      weekday,
      punches: list.map((p) => ({ time: p.timestamp.toTimeString().slice(0, 5), kind: p.kind })),
      workedMinutes: worked,
      expectedMinutes: expected,
      balanceMinutes: worked - expected,
      status,
    });
  }

  return { days, totalWorked, totalExpected, balance: totalWorked - totalExpected, faltas };
}
