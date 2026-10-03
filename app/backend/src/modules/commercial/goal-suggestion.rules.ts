/**
 * Meta de vendas sugerida a partir das despesas fixas.
 *
 * A loja precisa vender o bastante para que a margem das vendas pague as
 * despesas fixas do mês (ponto de equilíbrio):
 *
 *     venda mínima = despesas fixas ÷ margem de contribuição
 *
 * A margem de contribuição é quanto sobra de cada real vendido depois do custo
 * do móvel, das comissões e das taxas. Vem dos contratos reais quando há
 * histórico; senão, do mark-up e das comissões padrão.
 * Sobre o mínimo entram dois degraus: a meta recomendada (cobre as fixas e
 * deixa o lucro desejado) e a meta de desafio.
 */

export type GoalSuggestionInput = {
  fixedCosts: number;
  /** % do preço de venda que sobra para pagar as fixas (0–100) */
  marginPercent: number;
  /** lucro desejado no mês, em % das despesas fixas */
  profitPercent: number;
  avgTicket: number | null;
  sellers: { id: string; name: string; sold: number }[];
};

const round = (n: number) => Math.round(n / 100) * 100; // meta em centenas: número que se fala em reunião
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Margem de contribuição teórica a partir do mark-up e das comissões (preço = custo × mark-up ÷ (1 − comissões)). */
export function marginFromMarkup(markup: number, commissionPercent: number) {
  if (!(markup > 1)) return 0;
  return r2(((markup - 1) / markup) * (1 - commissionPercent / 100) * 100);
}

export function suggestGoal(i: GoalSuggestionInput) {
  if (!(i.fixedCosts > 0)) return { ok: false as const, reason: "Não há despesas fixas cadastradas para o mês. Cadastre-as em Financeiro → Fixos para o sistema calcular a meta." };
  if (!(i.marginPercent > 0)) return { ok: false as const, reason: "Não foi possível calcular a margem das vendas (mark-up igual ou menor que 1)." };
  const m = i.marginPercent / 100;
  const breakEven = i.fixedCosts / m;
  const recommended = (i.fixedCosts * (1 + i.profitPercent / 100)) / m;
  const stretch = recommended * 1.25;
  const contracts = (v: number) => (i.avgTicket && i.avgTicket > 0 ? Math.ceil(v / i.avgTicket) : null);

  // divisão entre vendedores: pela participação nas vendas recentes; sem histórico, partes iguais
  const totalSold = i.sellers.reduce((s, x) => s + x.sold, 0);
  const goal = round(recommended);
  const bySeller = i.sellers.map((s) => {
    const share = totalSold > 0 ? s.sold / totalSold : 1 / i.sellers.length;
    return { id: s.id, name: s.name, sharePercent: r2(share * 100), suggested: round(goal * share) };
  });

  return {
    ok: true as const,
    fixedCosts: r2(i.fixedCosts),
    marginPercent: r2(i.marginPercent),
    profitPercent: i.profitPercent,
    breakEven: round(breakEven),
    recommended: goal,
    stretch: round(stretch),
    expectedProfit: r2(goal * m - i.fixedCosts),
    avgTicket: i.avgTicket ? r2(i.avgTicket) : null,
    contracts: { breakEven: contracts(breakEven), recommended: contracts(recommended), stretch: contracts(stretch) },
    bySeller,
    sellersBasis: totalSold > 0 ? ("HISTORY" as const) : ("EQUAL" as const),
  };
}
