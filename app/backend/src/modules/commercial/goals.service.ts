/**
 * Metas comerciais: meta do mês, quanto já foi vendido, quanto falta e a
 * previsão. Funções puras.
 *
 * "Vendido" é a Venda registrada (valor fechado), não o valor estimado da
 * oportunidade: é o número que a loja fecha no caixa.
 */
import { ValidationError } from "../../utils/ApiError";

const FORTALEZA_TZ = "America/Fortaleza";

/** Mês no formato aaaa-mm, validado. */
export function parseMonth(value: unknown, now = new Date()): string {
  if (value === undefined || value === null || value === "") {
    return now.toLocaleDateString("en-CA", { timeZone: FORTALEZA_TZ }).slice(0, 7);
  }
  const m = String(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new ValidationError("Mês inválido. Use o formato aaaa-mm", { month: m });
  return m;
}

/** Início e fim do mês no fuso da loja (Fortaleza é UTC-3 o ano todo). */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, mo] = month.split("-").map(Number);
  // meia-noite de Fortaleza = 03:00 UTC
  const from = new Date(Date.UTC(y, mo - 1, 1, 3, 0, 0));
  const to = new Date(Date.UTC(y, mo, 1, 3, 0, 0));
  return { from, to };
}

/** Dias corridos do mês e quantos já passaram, para o ritmo necessário. */
export function monthPace(month: string, now = new Date()): { days: number; elapsed: number; remaining: number } {
  const { from, to } = monthRange(month);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  const clamp = Math.min(Math.max(now.getTime(), from.getTime()), to.getTime());
  const elapsed = Math.floor((clamp - from.getTime()) / 86_400_000);
  return { days, elapsed, remaining: Math.max(0, days - elapsed) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type GoalProgress = {
  goal: number | null;
  sold: number;
  missing: number | null;
  percent: number | null;
  /** quanto precisa vender por dia no que resta do mês */
  dailyNeeded: number | null;
  /** vendido + previsão ponderada das oportunidades que fecham no mês */
  projected: number;
  onTrack: boolean | null;
};

/**
 * Progresso contra a meta. Sem meta cadastrada, devolve os números sem
 * percentual — a tela mostra "defina uma meta" em vez de 0%.
 */
export function goalProgress(input: {
  goal: number | null;
  sold: number;
  weightedPipeline: number;
  month: string;
  now?: Date;
}): GoalProgress {
  const { goal, sold, weightedPipeline, month, now = new Date() } = input;
  const projected = round2(sold + weightedPipeline);
  if (goal === null || goal <= 0) {
    return { goal: null, sold: round2(sold), missing: null, percent: null, dailyNeeded: null, projected, onTrack: null };
  }
  const missing = round2(Math.max(0, goal - sold));
  const pace = monthPace(month, now);
  return {
    goal: round2(goal),
    sold: round2(sold),
    missing,
    percent: Math.round((sold / goal) * 1000) / 10,
    dailyNeeded: missing === 0 ? 0 : pace.remaining > 0 ? round2(missing / pace.remaining) : null,
    projected,
    onTrack: projected >= goal,
  };
}

/** Taxa de conversão de propostas em venda, em %. */
export function conversionRate(proposals: number, won: number): number | null {
  if (proposals <= 0) return null;
  return Math.round((won / proposals) * 1000) / 10;
}
