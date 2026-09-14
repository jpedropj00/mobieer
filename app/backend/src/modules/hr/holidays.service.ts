/**
 * Feriados nacionais, estaduais (Ceará) e municipais (Fortaleza).
 *
 * Os feriados fixos e os móveis (calculados a partir da Páscoa) são gerados em
 * código — não precisam de cadastro. A empresa pode acrescentar recessos e
 * pontos facultativos próprios em `CompanyHoliday`, que entram na mesma lista.
 *
 * `optional: true` = ponto facultativo (não é feriado por lei, mas costuma
 * parar o expediente). A empresa pode sobrescrever qualquer um cadastrando o
 * mesmo dia em CompanyHoliday.
 */
import { prisma } from "../../prisma";

export type HolidayScope = "NACIONAL" | "ESTADUAL" | "MUNICIPAL" | "EMPRESA";

export type Holiday = {
  date: string; // yyyy-mm-dd
  name: string;
  scope: HolidayScope;
  optional: boolean;
  source: "CALENDARIO" | "EMPRESA";
  id?: string;
  notes?: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Data em UTC puro, para não escorregar de dia por fuso. */
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/**
 * Feriados do calendário para um ano. Fortaleza/CE.
 *
 * Municipais/estaduais seguem lei local e podem mudar — a lista abaixo cobre os
 * consolidados; recessos e ajustes ficam por conta do cadastro da empresa.
 */
export function calendarHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const fixed: [number, number, string, HolidayScope, boolean][] = [
    [1, 1, "Confraternização Universal", "NACIONAL", false],
    [4, 21, "Tiradentes", "NACIONAL", false],
    [5, 1, "Dia do Trabalho", "NACIONAL", false],
    [9, 7, "Independência do Brasil", "NACIONAL", false],
    [10, 12, "Nossa Senhora Aparecida", "NACIONAL", false],
    [11, 2, "Finados", "NACIONAL", false],
    [11, 15, "Proclamação da República", "NACIONAL", false],
    [11, 20, "Consciência Negra", "NACIONAL", false],
    [12, 25, "Natal", "NACIONAL", false],
    // Ceará
    [3, 25, "Data Magna do Ceará", "ESTADUAL", false],
    // Fortaleza
    [8, 15, "Nossa Senhora da Assunção (padroeira de Fortaleza)", "MUNICIPAL", false],
    [3, 19, "São José", "MUNICIPAL", false],
    // Pontos facultativos usuais
    [12, 24, "Véspera de Natal", "NACIONAL", true],
    [12, 31, "Véspera de Ano Novo", "NACIONAL", true],
  ];

  const movable: [Date, string, HolidayScope, boolean][] = [
    [addDays(easter, -48), "Segunda-feira de Carnaval", "NACIONAL", true],
    [addDays(easter, -47), "Carnaval", "NACIONAL", true],
    [addDays(easter, -46), "Quarta-feira de Cinzas (até as 14h)", "NACIONAL", true],
    [addDays(easter, -2), "Sexta-feira Santa (Paixão de Cristo)", "NACIONAL", false],
    [easter, "Páscoa", "NACIONAL", false],
    [addDays(easter, 60), "Corpus Christi", "NACIONAL", true],
  ];

  const list: Holiday[] = [
    ...fixed.map(([m, d, name, scope, optional]) => ({
      date: ymd(utc(year, m, d)),
      name,
      scope,
      optional,
      source: "CALENDARIO" as const,
    })),
    ...movable.map(([dt, name, scope, optional]) => ({
      date: ymd(dt),
      name,
      scope,
      optional,
      source: "CALENDARIO" as const,
    })),
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Calendário + feriados/recessos cadastrados pela empresa, do ano pedido. */
export async function holidaysForYear(organizationId: string, year: number): Promise<Holiday[]> {
  const custom = await prisma.companyHoliday.findMany({
    where: { organizationId, date: { gte: utc(year, 1, 1), lte: utc(year, 12, 31) } },
    orderBy: { date: "asc" },
  });
  const customList: Holiday[] = custom.map((h) => ({
    id: h.id,
    date: ymd(h.date),
    name: h.name,
    scope: h.scope as HolidayScope,
    optional: h.optional,
    notes: h.notes,
    source: "EMPRESA" as const,
  }));
  // Cadastro da empresa tem precedência sobre o calendário na mesma data+nome.
  const taken = new Set(customList.map((h) => `${h.date}|${h.name.toLowerCase()}`));
  const merged = [...customList, ...calendarHolidays(year).filter((h) => !taken.has(`${h.date}|${h.name.toLowerCase()}`))];
  return merged.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Próximos feriados a partir de hoje (atravessa a virada do ano). */
export async function upcomingHolidays(organizationId: string, days: number, from = new Date()): Promise<Holiday[]> {
  const start = ymd(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())));
  const end = ymd(addDays(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())), days));
  const years = new Set([from.getUTCFullYear(), Number(end.slice(0, 4))]);
  const all: Holiday[] = [];
  for (const y of years) all.push(...(await holidaysForYear(organizationId, y)));
  return all.filter((h) => h.date >= start && h.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

const DAY = 86400000;
const SCOPE_LABEL: Record<HolidayScope, string> = {
  NACIONAL: "feriado nacional",
  ESTADUAL: "feriado estadual (CE)",
  MUNICIPAL: "feriado municipal (Fortaleza)",
  EMPRESA: "recesso da empresa",
};

/**
 * Job: avisa a equipe dos feriados dos próximos 7 dias. Cada feriado gera um
 * aviso uma única vez (HolidayNoticeLog), para todos os usuários ativos.
 */
export async function runHolidayNotices(daysAhead = 7, now = new Date()) {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let created = 0;
  let announced = 0;

  for (const org of orgs) {
    const upcoming = await upcomingHolidays(org.id, daysAhead, now);
    if (!upcoming.length) continue;
    const users = await prisma.user.findMany({ where: { organizationId: org.id, status: "ACTIVE" }, select: { id: true } });
    if (!users.length) continue;

    for (const h of upcoming) {
      const date = new Date(`${h.date}T00:00:00.000Z`);
      const already = await prisma.holidayNoticeLog.findFirst({
        where: { organizationId: org.id, date, name: h.name },
        select: { id: true },
      });
      if (already) continue;

      const daysTo = Math.round((date.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY);
      const quando = daysTo <= 0 ? "hoje" : daysTo === 1 ? "amanhã" : `em ${daysTo} dias`;
      const label = h.optional ? "ponto facultativo" : SCOPE_LABEL[h.scope];
      const message = `${h.name} — ${label} ${quando} (${date.toLocaleDateString("pt-BR", { timeZone: "UTC" })}).${h.optional ? " Confirme o expediente com a gestão." : ""}`;

      await prisma.notification.createMany({
        data: users.map((u) => ({ type: "INFO" as const, title: "Aviso de feriado", message, userId: u.id })),
      });
      await prisma.holidayNoticeLog.create({
        data: { organizationId: org.id, date, name: h.name, notifiedCount: users.length },
      });
      created += users.length;
      announced++;
    }
  }
  return { holidays: announced, notifications: created };
}
