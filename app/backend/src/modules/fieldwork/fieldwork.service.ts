/**
 * Regras do trabalho de campo: localização no ponto, banco de horas do
 * montador, medidas por ambiente e avaliação da montagem. Funções puras.
 */
import { ValidationError } from "../../utils/ApiError";
import { localDay, shiftMinutes } from "../contractors/contractors.service";

// ---------------------------------------------------------------------------
// Localização no ponto (§2.1, LGPD)
// ---------------------------------------------------------------------------

export type GeoInput = { consent?: boolean; lat?: number | null; lng?: number | null; accuracy?: number | null };
export type GeoFix = { lat: number; lng: number; accuracy: number | null } | null;

/**
 * Localização só vale com consentimento explícito da pessoa, na hora do
 * registro. Sem consentimento, qualquer coordenada enviada é descartada — o
 * ponto funciona igual. Coordenada impossível é recusada.
 */
export function acceptLocation(input: GeoInput): { consent: boolean; fix: GeoFix } {
  if (!input.consent) return { consent: false, fix: null };
  if (input.lat == null || input.lng == null) return { consent: true, fix: null };
  const { lat, lng } = input;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new ValidationError("Latitude inválida");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new ValidationError("Longitude inválida");
  if (lat === 0 && lng === 0) throw new ValidationError("Localização inválida (0,0) — o aparelho não conseguiu a posição");
  const accuracy = input.accuracy != null && Number.isFinite(input.accuracy) && input.accuracy > 0 ? Math.round(input.accuracy) : null;
  // 6 casas ≈ 10 cm: mais que isso é ruído, e menos precisão também protege a privacidade
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { consent: true, fix: { lat: round(lat), lng: round(lng), accuracy } };
}

/** Distância em metros entre dois pontos (haversine) — para conferir entrada x saída. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Banco de horas do montador (§2.2)
// ---------------------------------------------------------------------------

export type ShiftLike = { checkInAt: Date; checkOutAt: Date | null };

export type HourBankDay = { day: string; shifts: number; workedMinutes: number; expectedMinutes: number; extraMinutes: number; balanceMinutes: number };

/**
 * Banco de horas por dia trabalhado. Montador externo não tem escala fixa:
 * a jornada prevista conta nos dias em que ele trabalhou, não em todo dia útil.
 * Ponto em aberto (sem saída) não entra — ainda não se sabe quanto durou.
 */
export function hourBank(shifts: ShiftLike[], expectedDailyMinutes: number) {
  if (!(expectedDailyMinutes > 0) || expectedDailyMinutes > 24 * 60) throw new ValidationError("Jornada prevista inválida");
  const byDay = new Map<string, { shifts: number; worked: number }>();
  for (const s of shifts) {
    if (!s.checkOutAt) continue;
    const day = localDay(s.checkInAt);
    const cur = byDay.get(day) ?? { shifts: 0, worked: 0 };
    cur.shifts += 1;
    cur.worked += shiftMinutes(s.checkInAt, s.checkOutAt);
    byDay.set(day, cur);
  }
  const days: HourBankDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({
      day,
      shifts: v.shifts,
      workedMinutes: v.worked,
      expectedMinutes: expectedDailyMinutes,
      extraMinutes: Math.max(0, v.worked - expectedDailyMinutes),
      balanceMinutes: v.worked - expectedDailyMinutes,
    }));
  const sum = (k: keyof Omit<HourBankDay, "day">) => days.reduce((a, d) => a + d[k], 0);
  return {
    days,
    totals: {
      daysWorked: days.length,
      workedMinutes: sum("workedMinutes"),
      expectedMinutes: sum("expectedMinutes"),
      extraMinutes: sum("extraMinutes"),
      balanceMinutes: sum("balanceMinutes"),
    },
    openShifts: shifts.filter((s) => !s.checkOutAt).length,
  };
}

/** Minutos em "7h30", "-1h05", "0h". */
export function fmtMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(Math.round(min));
  return `${sign}${Math.floor(abs / 60)}h${abs % 60 ? String(abs % 60).padStart(2, "0") : ""}`;
}

// ---------------------------------------------------------------------------
// Medidas por ambiente (§13)
// ---------------------------------------------------------------------------

const MAX_ROOM_MM = 30_000; // 30 m: acima disso é unidade errada

export type RoomMeasureInput = {
  name: string;
  widthMm?: number | null;
  heightMm?: number | null;
  depthMm?: number | null;
  ceilingHeightMm?: number | null;
};

/** Confere as medidas do ambiente. Medidas em milímetros; nenhuma é obrigatória. */
export function validateRoomMeasure(m: RoomMeasureInput) {
  if (!m.name?.trim()) throw new ValidationError("Informe o ambiente");
  for (const [label, v] of [
    ["largura", m.widthMm],
    ["altura", m.heightMm],
    ["profundidade", m.depthMm],
    ["pé-direito", m.ceilingHeightMm],
  ] as const) {
    if (v == null) continue;
    if (!(v > 0)) throw new ValidationError(`${m.name}: ${label} precisa ser maior que zero`);
    if (v > MAX_ROOM_MM) throw new ValidationError(`${m.name}: ${label} de ${v} mm parece errada — as medidas são em milímetros`);
  }
  if (m.ceilingHeightMm != null && m.heightMm != null && m.heightMm > m.ceilingHeightMm) {
    throw new ValidationError(`${m.name}: a altura (${m.heightMm} mm) passa do pé-direito (${m.ceilingHeightMm} mm)`);
  }
}

/** Campos que, se mudarem, geram versão nova da medida. */
export const MEASURE_FIELDS = ["name", "widthMm", "heightMm", "depthMm", "ceilingHeightMm", "plumbingPoints", "electricalPoints", "interferences", "notes"] as const;

export function measureChanged(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "object" ? String(v) : String(v));
  return MEASURE_FIELDS.filter((k) => after[k] !== undefined && norm(before[k]) !== norm(after[k]));
}

// ---------------------------------------------------------------------------
// Avaliação do montador (§2.7)
// ---------------------------------------------------------------------------

export type RatingInput = {
  quality: number;
  deadline: number;
  organizationScore: number;
  finish: number;
  service: number;
  rework: boolean;
  reworkNotes?: string | null;
};

export const RATING_LABEL = {
  quality: "Qualidade",
  deadline: "Prazo",
  organizationScore: "Organização",
  finish: "Acabamento",
  service: "Atendimento",
} as const;

export function validateRating(r: RatingInput) {
  for (const k of Object.keys(RATING_LABEL) as (keyof typeof RATING_LABEL)[]) {
    const v = r[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new ValidationError(`${RATING_LABEL[k]}: dê uma nota de 1 a 5`);
  }
  if (r.rework && !r.reworkNotes?.trim()) throw new ValidationError("Descreva o retrabalho que foi preciso");
}

/** Média das cinco notas de uma avaliação. */
export const ratingAverage = (r: RatingInput) => Math.round(((r.quality + r.deadline + r.organizationScore + r.finish + r.service) / 5) * 10) / 10;

/** Histórico de desempenho do montador. */
export function performanceSummary(ratings: RatingInput[]) {
  if (!ratings.length) return { count: 0, average: null, byCriterion: null, reworkRate: null };
  const avg = (k: keyof typeof RATING_LABEL) => Math.round((ratings.reduce((a, r) => a + r[k], 0) / ratings.length) * 10) / 10;
  return {
    count: ratings.length,
    average: Math.round((ratings.reduce((a, r) => a + ratingAverage(r), 0) / ratings.length) * 10) / 10,
    byCriterion: {
      quality: avg("quality"),
      deadline: avg("deadline"),
      organizationScore: avg("organizationScore"),
      finish: avg("finish"),
      service: avg("service"),
    },
    reworkRate: Math.round((ratings.filter((r) => r.rework).length / ratings.length) * 1000) / 10,
  };
}
