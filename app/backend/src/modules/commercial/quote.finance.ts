/**
 * Orçamento aceito → lançamentos no financeiro.
 *
 * Entrada vence no dia do aceite. O restante depende da forma:
 *  - à vista / PIX: um recebível no dia;
 *  - boleto: N parcelas mensais, a primeira um mês depois;
 *  - cartão: N repasses mensais da maquininha, com a taxa como despesa em cada um;
 *  - financeira: a financeira repassa o valor de uma vez em 30 dias, com a taxa
 *    como despesa no mesmo dia (o cliente paga as parcelas a ela, não à loja).
 * O recebível é bruto e a taxa é despesa à parte, para a DRE mostrar a taxa
 * como despesa financeira em vez de sumir dentro da receita.
 * Comissões viram contas a pagar no vencimento da primeira parcela.
 *
 * Vencimento é data de calendário: meia-noite UTC do dia (ver finance/documents).
 */
import type { PaymentMethod } from "./quote.rules";

export type QuoteForFinance = {
  number: string;
  version: number;
  total: number;
  payment: { method: PaymentMethod; planName: string | null; installments: number; downPayment: number; feePercent: number };
  commissions: { name: string; percent: number; amount: number; role?: string; referrerId?: string | null }[];
};

export type PlannedEntry = {
  type: "RECEITA" | "DESPESA";
  category: string;
  amount: number;
  /** aaaa-mm-dd */
  dueDay: string;
  description: string;
  method: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  /** reserva técnica: a quem pagar */
  referrerId?: string | null;
};

export const CATEGORY_SALE = "Contrato — venda";
export const CATEGORY_FINANCING_FEE = "Taxa de financiamento";
export const CATEGORY_CARD_FEE = "Taxa de cartão";
export const CATEGORY_COMMISSION = "Comissão de venda";
export const CATEGORY_TECHNICAL_RESERVE = "Reserva técnica";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Soma meses a um dia aaaa-mm-dd; 31/01 + 1 mês = 28 ou 29/02. */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export function addDaysDay(day: string, days: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Divide em N partes de centavos inteiros; a diferença do arredondamento vai na última. */
export function splitAmount(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100);
}

export function planFinance(q: QuoteForFinance, today: string): PlannedEntry[] {
  const ref = `Orçamento ${q.number}${q.version > 1 ? ` v${q.version}` : ""}`;
  const out: PlannedEntry[] = [];
  const p = q.payment;
  const down = Math.min(r2(Math.max(0, p.downPayment)), q.total);
  const rest = r2(q.total - down);
  const receita = (amount: number, dueDay: string, description: string, method: string, n: number | null = null, of: number | null = null) =>
    out.push({ type: "RECEITA", category: CATEGORY_SALE, amount, dueDay, description, method, installmentNumber: n, installmentTotal: of });
  const taxa = (category: string, amount: number, dueDay: string, description: string, method: string) => {
    if (amount > 0) out.push({ type: "DESPESA", category, amount, dueDay, description, method, installmentNumber: null, installmentTotal: null });
  };

  if (down > 0) receita(down, today, `${ref} — entrada`, "Entrada");

  let firstDue = today;
  if (rest > 0) {
    if (p.method === "AVISTA" || p.method === "PIX") {
      receita(rest, today, `${ref} — ${p.method === "PIX" ? "PIX" : "à vista"}`, p.method === "PIX" ? "PIX" : "À vista");
    } else if (p.method === "BOLETO") {
      const n = Math.max(1, p.installments);
      splitAmount(rest, n).forEach((v, i) => receita(v, addMonthsDay(today, i + 1), `${ref} — parcela ${i + 1}/${n}`, "Boleto", i + 1, n));
      firstDue = addMonthsDay(today, 1);
    } else if (p.method === "CARTAO") {
      const n = Math.max(1, p.installments);
      const onde = p.planName ?? "Cartão";
      const fees = splitAmount(r2((rest * p.feePercent) / 100), n);
      splitAmount(rest, n).forEach((v, i) => {
        const due = addMonthsDay(today, i + 1);
        receita(v, due, `${ref} — ${onde} ${i + 1}/${n}`, "Cartão", i + 1, n);
        taxa(CATEGORY_CARD_FEE, fees[i], due, `${ref} — taxa ${onde} ${i + 1}/${n}`, "Cartão");
      });
      firstDue = addMonthsDay(today, 1);
    } else {
      const onde = p.planName ?? "financeira";
      const due = addDaysDay(today, 30);
      receita(rest, due, `${ref} — repasse ${onde}`, "Financeira");
      taxa(CATEGORY_FINANCING_FEE, r2((rest * p.feePercent) / 100), due, `${ref} — taxa ${onde}`, "Financeira");
      firstDue = due;
    }
  }

  for (const c of q.commissions) {
    if (c.amount > 0) {
      const rt = c.role === "INDICADOR";
      out.push({
        type: "DESPESA",
        category: rt ? CATEGORY_TECHNICAL_RESERVE : CATEGORY_COMMISSION,
        amount: r2(c.amount),
        dueDay: firstDue,
        description: `${ref} — ${rt ? "reserva técnica" : "comissão"} ${c.name} (${String(c.percent).replace(".", ",")}%)`,
        method: rt ? "Reserva técnica" : "Comissão",
        installmentNumber: null,
        installmentTotal: null,
        referrerId: rt ? c.referrerId ?? null : null,
      });
    }
  }
  return out;
}
