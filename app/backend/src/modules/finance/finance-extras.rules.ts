/**
 * Acréscimos do financeiro que não mexem nos lançamentos:
 *  - categorias criadas pela loja, além das que já vêm no sistema;
 *  - metas de investimento (o que a loja quer implantar e quanto custa).
 */

export type FinanceKind = "RECEITA" | "DESPESA";
export type CustomCategories = Record<FinanceKind, string[]>;

export const MAX_CATEGORIES = 60;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => clean(a).toLocaleLowerCase("pt-BR") === clean(b).toLocaleLowerCase("pt-BR");

export function normalizeCategories(raw: unknown): CustomCategories {
  const v = (raw ?? {}) as Partial<Record<FinanceKind, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string").map(clean).filter(Boolean) : []);
  return { RECEITA: list(v.RECEITA), DESPESA: list(v.DESPESA) };
}

/** Acrescenta sem repetir (ignora maiúsculas e espaços); `builtin` são as que já existem na tela. */
export function addCategory(current: CustomCategories, kind: FinanceKind, name: string, builtin: string[] = []): { categories: CustomCategories; added: boolean } {
  const value = clean(name);
  if (!value) throw new Error("Informe o nome da categoria");
  if (value.length > 60) throw new Error("O nome da categoria pode ter até 60 caracteres");
  if ([...builtin, ...current[kind]].some((c) => same(c, value))) return { categories: current, added: false };
  if (current[kind].length >= MAX_CATEGORIES) throw new Error(`Limite de ${MAX_CATEGORIES} categorias criadas atingido`);
  return { categories: { ...current, [kind]: [...current[kind], value] }, added: true };
}

export function removeCategory(current: CustomCategories, kind: FinanceKind, name: string): CustomCategories {
  return { ...current, [kind]: current[kind].filter((c) => !same(c, name)) };
}

// ---------------------------------------------------------------- metas de investimento

export type InvestmentGoal = {
  id: string;
  title: string;
  cost: number;
  /** Quanto já foi reservado ou pago para esta meta. */
  saved: number;
  targetDate: string | null;
  notes: string | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

export function normalizeGoals(raw: unknown): InvestmentGoal[] {
  return Array.isArray(raw) ? (raw as InvestmentGoal[]).filter((g) => g && typeof g.id === "string" && typeof g.title === "string") : [];
}

/** Quanto falta e o percentual reservado de uma meta (nunca passa de 100%). */
export function goalProgress(g: Pick<InvestmentGoal, "cost" | "saved" | "done">) {
  const cost = Math.max(0, g.cost);
  const saved = Math.max(0, Math.min(g.saved, cost));
  const percent = g.done ? 100 : cost > 0 ? Math.round((saved / cost) * 100) : 0;
  return { remaining: g.done ? 0 : Number((cost - saved).toFixed(2)), percent };
}

/** Totais do quadro: o que está planejado (em aberto), quanto já foi reservado e quanto falta. */
export function goalsSummary(goals: InvestmentGoal[]) {
  const open = goals.filter((g) => !g.done);
  const planned = open.reduce((s, g) => s + Math.max(0, g.cost), 0);
  const saved = open.reduce((s, g) => s + Math.max(0, Math.min(g.saved, g.cost)), 0);
  return {
    open: open.length,
    done: goals.length - open.length,
    planned: Number(planned.toFixed(2)),
    saved: Number(saved.toFixed(2)),
    remaining: Number((planned - saved).toFixed(2)),
    doneValue: Number(goals.filter((g) => g.done).reduce((s, g) => s + Math.max(0, g.cost), 0).toFixed(2)),
  };
}

/** Em aberto primeiro (as com data mais próxima antes), concluídas no fim. */
export function sortGoals(goals: InvestmentGoal[]): InvestmentGoal[] {
  return [...goals].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.doneAt ?? "").localeCompare(a.doneAt ?? "");
    if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
    if (a.targetDate || b.targetDate) return a.targetDate ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
