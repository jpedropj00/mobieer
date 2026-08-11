import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR");
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function isApiError(err: unknown): err is { message: string; details?: unknown } {
  return typeof err === "object" && err !== null && "message" in err;
}

export function errorMessage(err: unknown, fallback = "Erro inesperado"): string {
  if (isApiError(err)) {
    const msg = (err as { message?: string }).message;
    return msg || fallback;
  }
  return fallback;
}

export const UNITS: Record<string, string> = {
  UNIT: "Unidade",
  BOX: "Caixa",
  PACKAGE: "Pacote",
  METER: "Metro",
  LITER: "Litro",
  KILO: "Quilo",
  ROLL: "Rolo",
  PAIR: "Par",
};
