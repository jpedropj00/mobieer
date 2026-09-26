import type { TimeEntryKind } from "@prisma/client";

/**
 * Parser tolerante para arquivos de relógio de ponto.
 *
 * Dois formatos:
 *
 * 1. Com cabeçalho nomeado (S362E e similares): arquivo UTF-16 separado por
 *    TAB, com colunas No, TMNo, EnNo, Name, ..., DateTime, TR. Aqui a coluna
 *    da matrícula é lida pelo NOME (EnNo) — pelo palpite, a primeira coluna
 *    numérica seria "No" (o número da linha) e todas as marcações iriam para
 *    o colaborador errado.
 *
 * 2. Sem cabeçalho (KNUP KP-1028 e afins): CSV/TXT com ; , ou TAB e colunas em
 *    qualquer ordem — matrícula/PIS, data e hora, ou data-hora junta.
 *
 * As horas do aparelho são locais (Fortaleza, UTC-3 o ano todo) e viram UTC
 * na gravação; o dia e o espelho são montados no fuso da loja.
 *
 * O rótulo do aparelho (Time In, Job Out, Break On...) é guardado para
 * auditoria, mas NÃO define o tipo da marcação: na prática a equipe aperta a
 * tecla que estiver à mão — há dias com quatro "Time In" seguidos e saídas
 * registradas como "Break On". O que vale é a ordem cronológica.
 *
 * Linhas inválidas são contadas, não quebram o import.
 */

export type ParsedPunch = { registration: string; timestamp: Date; label?: string | null; name?: string | null };
export type ParseResult = { punches: ParsedPunch[]; errors: number; total: number };

const DATE_RE = /(\d{2})[/.-](\d{2})[/.-](\d{4})|(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;

const FORTALEZA_TZ = "America/Fortaleza";
/** Fortaleza é UTC-3 o ano todo (sem horário de verão desde 2019). */
const FORTALEZA_OFFSET_HOURS = 3;

/** Hora local do relógio -> instante em UTC. */
export function fortalezaToUtc(y: number, mo: number, d: number, hh: number, mi: number, ss = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, hh + FORTALEZA_OFFSET_HOURS, mi, ss));
}
/** Dia no calendário da loja (aaaa-mm-dd). */
export const fortalezaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: FORTALEZA_TZ });
/** Hora no relógio da loja (HH:MM). */
export const fortalezaTime = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { timeZone: FORTALEZA_TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Texto do arquivo. O S362E exporta em UTF-16 com BOM; lido como UTF-8 vira
 * lixo e o import inteiro falha, então o BOM decide a codificação.
 */
export function decodeTimeClockFile(buffer: Buffer): string {
  if (buffer.length >= 2) {
    const [b0, b1] = buffer;
    if (b0 === 0xff && b1 === 0xfe) return buffer.subarray(2).toString("utf16le");
    if (b0 === 0xfe && b1 === 0xff) {
      // UTF-16 big-endian: inverte os pares de bytes e lê como little-endian
      const swapped = Buffer.from(buffer.subarray(2));
      swapped.swap16();
      return swapped.toString("utf16le");
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString("utf8");
  const utf8 = buffer.toString("utf8");
  return utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
}

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
  const date = fortalezaToUtc(y, mo, d, hh, mi, ss);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Colunas do layout com cabeçalho nomeado, se houver. */
function headerColumns(lines: string[]): { index: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cols = lines[i].split("\t").map((c) => c.trim().toLowerCase());
    const enNo = cols.indexOf("enno");
    const dateTime = cols.indexOf("datetime");
    if (enNo >= 0 && dateTime >= 0) {
      return {
        index: i,
        cols: { enNo, dateTime, name: cols.indexOf("name"), label: cols.indexOf("tr"), inOut: cols.indexOf("in/out") },
      };
    }
  }
  return null;
}

/** Layout com cabeçalho: cada coluna é lida pelo nome. */
function parseWithHeader(lines: string[], header: { index: number; cols: Record<string, number> }): ParseResult {
  const { cols } = header;
  const punches: ParsedPunch[] = [];
  let errors = 0;
  let total = 0;

  for (const line of lines.slice(header.index + 1)) {
    if (line.startsWith("#")) continue;
    const c = line.split("\t");
    if (c.length <= cols.dateTime) continue;
    total++;

    const reg = (c[cols.enNo] ?? "").trim();
    const raw = (c[cols.dateTime] ?? "").trim();
    // "2026-01-10  03:35:25" — o aparelho usa dois espaços entre data e hora
    const [dateStr, timeStr] = raw.split(/\s+/);
    if (!reg || !dateStr || !timeStr) {
      errors++;
      continue;
    }
    const ts = toDate(dateStr, timeStr);
    if (!ts) {
      errors++;
      continue;
    }
    const label = cols.label >= 0 ? (c[cols.label] ?? "").trim() : cols.inOut >= 0 ? (c[cols.inOut] ?? "").trim() : "";
    punches.push({ registration: reg, timestamp: ts, label: label || null, name: cols.name >= 0 ? (c[cols.name] ?? "").trim() || null : null });
  }
  return { punches, errors, total };
}

export function parseTimeClockFile(buffer: Buffer): ParseResult {
  const text = decodeTimeClockFile(buffer);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const header = headerColumns(lines);
  if (header) return parseWithHeader(lines, header);

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


/** Texto comparável: sem acento, sem pontuação, minúsculo. */
const normalizeName = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * O nome que veio do relógio parece ser a mesma pessoa do cadastro?
 * Basta um nome próprio em comum (o aparelho guarda só o primeiro nome, e o
 * cadastro tem o nome completo). Serve para avisar antes de importar em cima
 * do colaborador errado — quem decide é uma pessoa.
 */
export function looksLikeSamePerson(fileName: string | null | undefined, employeeName: string): boolean {
  if (!fileName?.trim()) return true; // sem nome no arquivo não há como duvidar
  const a = normalizeName(fileName).split(" ").filter((w) => w.length >= 3);
  const b = new Set(normalizeName(employeeName).split(" "));
  return a.some((w) => b.has(w));
}

/** Alterna IN/OUT pela ordem cronológica das marcações do dia. */
export function inferKinds(sorted: Date[]): TimeEntryKind[] {
  // Marcações de um dia, em ordem: par entra, ímpar sai. A última saída do dia
  // é o fim do expediente (OUT); as saídas do meio são intervalo (BREAK_OUT).
  // Com número ímpar de marcações falta uma saída, então nada vira OUT e o dia
  // fecha como INCOMPLETO em vez de inventar um horário.
  const ultimaEhSaida = sorted.length % 2 === 0;
  return sorted.map((_, i) => {
    if (i % 2 === 0) return i === 0 ? "IN" : "BREAK_IN";
    return ultimaEhSaida && i === sorted.length - 1 ? "OUT" : "BREAK_OUT";
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
    // dia da loja: uma batida às 22h não pode cair no dia seguinte
    const key = fortalezaDay(e.timestamp);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(e);
  }

  const days: DayMirror[] = [];
  let totalWorked = 0;
  let totalExpected = 0;
  let faltas = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${String(d).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 dom ... 6 sáb
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
      punches: list.map((p) => ({ time: fortalezaTime(p.timestamp), kind: p.kind })),
      workedMinutes: worked,
      expectedMinutes: expected,
      balanceMinutes: worked - expected,
      status,
    });
  }

  return { days, totalWorked, totalExpected, balance: totalWorked - totalExpected, faltas };
}

/**
 * Banco de horas em um intervalo: consolida os saldos diários do espelho e
 * aplica os ajustes manuais (compensações, correções, pagamentos).
 * `days` já deve vir filtrado ao intervalo desejado.
 */
export function computeHourBank(
  days: DayMirror[],
  adjustments: { minutes: number }[]
): {
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number; // soma dos saldos diários positivos (horas extras acumuladas)
  deficitMinutes: number; // soma dos saldos diários negativos (déficit / faltas)
  rawBalanceMinutes: number; // worked - expected
  adjustmentMinutes: number; // soma dos ajustes manuais
  netBalanceMinutes: number; // saldo final do banco
  faltas: number;
} {
  let worked = 0;
  let expected = 0;
  let overtime = 0;
  let deficit = 0;
  let faltas = 0;
  for (const d of days) {
    worked += d.workedMinutes;
    expected += d.expectedMinutes;
    if (d.balanceMinutes > 0) overtime += d.balanceMinutes;
    else deficit += d.balanceMinutes;
    if (d.status === "FALTA") faltas++;
  }
  const adjustmentMinutes = adjustments.reduce((s, a) => s + a.minutes, 0);
  const rawBalance = worked - expected;
  return {
    workedMinutes: worked,
    expectedMinutes: expected,
    overtimeMinutes: overtime,
    deficitMinutes: deficit,
    rawBalanceMinutes: rawBalance,
    adjustmentMinutes,
    netBalanceMinutes: rawBalance + adjustmentMinutes,
    faltas,
  };
}

/** Lista de "YYYY-MM" de `from` até `to` (inclusive), para iterar o espelho. */
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cur <= end) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
