/**
 * Regras dos documentos financeiros (boleto, fatura, NF, recibo).
 *
 * Nada aqui toca no banco: são funções puras, cobertas por teste, usadas pelas
 * rotas e pelo job diário de alerta de vencimento.
 *
 * Decisão importante sobre status: o banco guarda só o ciclo de vida real do
 * documento (PENDENTE, PARCIAL, PAGO, CANCELADO). "Vencido" e "próximo do
 * vencimento" são calculados na leitura a partir do vencimento e da
 * antecedência configurada — assim nunca ficam defasados se o job diário
 * atrasar ou não rodar. A tela e os filtros enxergam as seis situações.
 */
import { FinanceStatus } from "@prisma/client";
import { ValidationError } from "../../utils/ApiError";

const FORTALEZA_TZ = "America/Fortaleza";

/** Dia local de Fortaleza (aaaa-mm-dd). Usado para saber que dia é "hoje" na loja. */
export const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: FORTALEZA_TZ });

/**
 * Dia do vencimento (aaaa-mm-dd), lido em UTC.
 *
 * Vencimento é data de calendário, não instante. O `<input type="date">` manda
 * "2026-09-14", que vira 2026-09-14T00:00:00Z; lido no fuso de Fortaleza
 * (UTC-3) isso voltaria para o dia 13 e o documento apareceria vencido um dia
 * antes da hora — e cairia na semana errada no calendário de vencimentos.
 * Por isso o vencimento é sempre lido em UTC, e só o "hoje" usa o fuso da loja.
 */
export const dueDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "UTC" });

/** Situações que a tela mostra e os filtros aceitam. */
export const FINANCE_SITUATIONS = ["PENDENTE", "A_VENCER", "VENCIDO", "PARCIAL", "PAGO", "CANCELADO"] as const;
export type FinanceSituation = (typeof FINANCE_SITUATIONS)[number];

export const SITUATION_LABEL: Record<FinanceSituation, string> = {
  PENDENTE: "Pendente",
  A_VENCER: "Próximo do vencimento",
  VENCIDO: "Vencido",
  PARCIAL: "Pagamento parcial",
  PAGO: "Pago",
  CANCELADO: "Cancelado",
};

/** Antecedências de alerta que a configuração aceita. */
export const ALERT_DAY_OPTIONS = [1, 3, 5, 7] as const;
export const DEFAULT_ALERT_DAYS = 3;

export function normalizeAlertDays(value: unknown, fallback = DEFAULT_ALERT_DAYS): number {
  const n = Number(value);
  return (ALERT_DAY_OPTIONS as readonly number[]).includes(n) ? n : fallback;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Quanto ainda falta pagar. Nunca negativo. */
export function remainingBalance(amount: number, paidAmount: number): number {
  return round2(Math.max(0, amount - paidAmount));
}

/**
 * Status persistido depois de somar os pagamentos.
 * Um pagamento parcial mantém o documento em aberto (PARCIAL), como pedido.
 */
export function statusAfterPayments(amount: number, paidAmount: number): FinanceStatus {
  if (paidAmount <= 0) return FinanceStatus.PENDENTE;
  // tolerância de um centavo para arredondamento de parcelas
  if (paidAmount >= round2(amount) - 0.01) return FinanceStatus.PAGO;
  return FinanceStatus.PARCIAL;
}

/** Dias inteiros entre hoje e o vencimento, no calendário de Fortaleza. Negativo = vencido. */
export function daysUntilDue(dueDate: Date, now = new Date()): number {
  const due = Date.parse(`${dueDay(dueDate)}T00:00:00Z`);
  const today = Date.parse(`${localDay(now)}T00:00:00Z`);
  return Math.round((due - today) / 86_400_000);
}

/**
 * Situação exibida. A ordem importa: cancelado e pago encerram o documento,
 * depois o atraso, depois a proximidade do vencimento.
 */
export function financeSituation(
  doc: { status: FinanceStatus; dueDate: Date | null; alertDays?: number | null },
  orgAlertDays = DEFAULT_ALERT_DAYS,
  now = new Date()
): FinanceSituation {
  if (doc.status === FinanceStatus.CANCELADO) return "CANCELADO";
  if (doc.status === FinanceStatus.PAGO) return "PAGO";
  if (doc.dueDate) {
    const days = daysUntilDue(doc.dueDate, now);
    if (days < 0) return "VENCIDO";
    if (days <= normalizeAlertDays(doc.alertDays, orgAlertDays)) return "A_VENCER";
  }
  return doc.status === FinanceStatus.PARCIAL ? "PARCIAL" : "PENDENTE";
}

/** Documento em aberto: ainda consome caixa. */
export const isOpen = (status: FinanceStatus) => status === FinanceStatus.PENDENTE || status === FinanceStatus.PARCIAL;

/** Valida o valor de um pagamento contra o saldo. */
export function assertPaymentAmount(amount: number, docAmount: number, alreadyPaid: number) {
  if (!(amount > 0)) throw new ValidationError("O valor do pagamento precisa ser maior que zero");
  const remaining = remainingBalance(docAmount, alreadyPaid);
  if (remaining <= 0) throw new ValidationError("Este documento já está quitado");
  if (round2(amount) > remaining + 0.01) {
    throw new ValidationError(
      `O pagamento de ${amount.toFixed(2)} passa do saldo em aberto (${remaining.toFixed(2)})`,
      { amount, remaining }
    );
  }
}

/** Só documentos em aberto aceitam pagamento. */
export function assertPayable(status: FinanceStatus) {
  if (status === FinanceStatus.CANCELADO) throw new ValidationError("Documento cancelado não recebe pagamento");
  if (status === FinanceStatus.PAGO) throw new ValidationError("Este documento já está quitado");
}

export type DueGrouping = "day" | "week" | "month";

/** Início da semana (segunda-feira) no calendário de Fortaleza, como aaaa-mm-dd. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

/** Chave do balde de vencimento conforme a visão escolhida. */
export function dueBucket(dueDate: Date, grouping: DueGrouping): string {
  const day = dueDay(dueDate);
  if (grouping === "day") return day;
  if (grouping === "month") return day.slice(0, 7);
  return weekStart(day);
}

/**
 * Agrupa documentos por vencimento, sempre do vencimento mais próximo para o
 * mais distante — dentro do balde e entre os baldes.
 */
export function groupByDue<T extends { dueDate: Date | null; amount: number; paidAmount: number }>(
  docs: T[],
  grouping: DueGrouping
): { bucket: string; total: number; remaining: number; items: T[] }[] {
  const buckets = new Map<string, { bucket: string; total: number; remaining: number; items: T[] }>();
  for (const doc of docs) {
    if (!doc.dueDate) continue;
    const key = dueBucket(doc.dueDate, grouping);
    const b = buckets.get(key) ?? { bucket: key, total: 0, remaining: 0, items: [] };
    b.total = round2(b.total + doc.amount);
    b.remaining = round2(b.remaining + remainingBalance(doc.amount, doc.paidAmount));
    b.items.push(doc);
    buckets.set(key, b);
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, items: b.items.sort((a, z) => (a.dueDate!.getTime() - z.dueDate!.getTime())) }))
    .sort((a, z) => a.bucket.localeCompare(z.bucket));
}
