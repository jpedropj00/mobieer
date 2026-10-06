/**
 * Presença do montador externo lançada pelo escritório ("veio" / "não veio").
 * Serve para quem ainda não tem login e também para quem tem: é um registro
 * por dia, independente do check-in feito pelo próprio montador.
 */

const OFFSET = "-03:00"; // Fortaleza

export type AttendanceMark = "PRESENT" | "ABSENT" | "NONE";

/** Turno que representa um dia lançado como "veio": 8h às 17h, horário de Fortaleza. */
export function attendanceShiftTimes(day: string) {
  const checkInAt = new Date(`${day}T08:00:00.000${OFFSET}`);
  const checkOutAt = new Date(`${day}T17:00:00.000${OFFSET}`);
  return { checkInAt, checkOutAt, minutes: Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000) };
}

/** Limites do dia local, para achar turnos (check-in) daquele dia. */
export function dayBounds(day: string) {
  return { from: new Date(`${day}T00:00:00.000${OFFSET}`), to: new Date(`${day}T23:59:59.999${OFFSET}`) };
}

/** Dia local (AAAA-MM-DD) de um instante. */
export function localDayOf(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Dias de `from` a `to`, inclusive (no máximo 62). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < 62; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Segunda a sábado da semana de `day`. */
export function weekOf(day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: new Date(monday.getTime() + 5 * 86_400_000).toISOString().slice(0, 10) };
}

type Rec = { contractorId: string; date: string; present: boolean };

/** Totais por montador no período: dias em que veio, faltas e dias sem lançamento. */
export function attendanceTotals(contractorIds: string[], days: string[], records: Rec[], selfCheckIns: { contractorId: string; date: string }[] = []) {
  const byKey = new Map(records.map((r) => [`${r.contractorId}|${r.date}`, r.present]));
  const self = new Set(selfCheckIns.map((s) => `${s.contractorId}|${s.date}`));
  return contractorIds.map((id) => {
    let present = 0;
    let absent = 0;
    let none = 0;
    for (const d of days) {
      const k = `${id}|${d}`;
      const mark = byKey.get(k);
      // sem lançamento do escritório, vale o check-in que o próprio montador fez
      if (mark === true || (mark === undefined && self.has(k))) present++;
      else if (mark === false) absent++;
      else none++;
    }
    return { contractorId: id, present, absent, none };
  });
}
