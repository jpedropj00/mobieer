import { Prisma } from "@prisma/client";

/**
 * DRE formal (Demonstração do Resultado do Exercício).
 * Classifica as categorias livres de FinanceTransaction nas linhas da DRE;
 * um mapeamento explícito (DreCategoryMapping) sempre vence o classificador.
 */

export const DRE_LINE_KEYS = [
  "RECEITA_BRUTA",
  "DEDUCOES",
  "RECEITA_FINANCEIRA",
  "CUSTO",
  "DESPESA_VENDAS",
  "DESPESA_ADMIN",
  "DESPESA_GERAL",
  "DESPESA_FINANCEIRA",
  "DEPRECIACAO",
  "IMPOSTOS_RENDA",
] as const;
export type DreLineKey = (typeof DRE_LINE_KEYS)[number];

export const DRE_LINE_LABEL: Record<DreLineKey, string> = {
  RECEITA_BRUTA: "Receita bruta de vendas",
  DEDUCOES: "Deduções e impostos sobre vendas",
  RECEITA_FINANCEIRA: "Receitas financeiras",
  CUSTO: "Custo dos produtos e serviços vendidos (CPV)",
  DESPESA_VENDAS: "Despesas com vendas",
  DESPESA_ADMIN: "Despesas administrativas",
  DESPESA_GERAL: "Despesas gerais",
  DESPESA_FINANCEIRA: "Despesas financeiras",
  DEPRECIACAO: "Depreciação e amortização",
  IMPOSTOS_RENDA: "IRPJ e CSLL",
};

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/** Classificador por palavra-chave (fallback quando não há mapeamento). */
export function classifyDreLine(type: "RECEITA" | "DESPESA" | string, category: string): DreLineKey {
  const c = category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "");

  if (type === "RECEITA") {
    if (has(c, "juro", "rendiment", "aplicac", "financeira")) return "RECEITA_FINANCEIRA";
    if (has(c, "devoluc", "desconto concedido", "abatiment")) return "DEDUCOES";
    return "RECEITA_BRUTA";
  }

  // DESPESA
  if (has(c, "irpj", "csll")) return "IMPOSTOS_RENDA";
  if (has(c, "das", "simples nacional", "iss", "icms", "pis", "cofins", "imposto", "tributo")) return "DEDUCOES";
  if (has(c, "juro", "tarifa banc", "iof", "multa", "financiament", "emprestim", "antecipac")) return "DESPESA_FINANCEIRA";
  if (has(c, "depreciac", "amortizac")) return "DEPRECIACAO";
  if (
    has(
      c,
      "materia-prima",
      "materia prima",
      "insumo",
      "mdf",
      "chapa",
      "ferragen",
      "acabament",
      "fixador",
      "marcenaria",
      "corte",
      "fita de borda",
      "vidro",
      "terceirizac",
      "frete de compra",
      "embalagem"
    )
  )
    return "CUSTO";
  if (has(c, "marketing", "publicidade", "propaganda", "comiss", "anuncio", "brinde", "evento", "feira", "frete de entrega", "entrega", "montagem"))
    return "DESPESA_VENDAS";
  if (
    has(
      c,
      "folha de pagament",
      "salario",
      "pro-labore",
      "pro labore",
      "encargo",
      "aluguel",
      "condominio",
      "energia",
      "agua",
      "internet",
      "telefone",
      "software",
      "assinatura",
      "contabil",
      "escritorio",
      "material de escritorio",
      "juridico",
      "seguro"
    )
  )
    return "DESPESA_ADMIN";
  return "DESPESA_GERAL";
}

type Tx = { type: string; category: string; amount: Prisma.Decimal | number; status: string };
type DreLine = { key: string; label: string; value: number; kind: "line" | "subtotal" | "result"; sign: 1 | -1 | 0 };

/** Ordem e composição das linhas + subtotais da DRE. */
export function buildDre(
  txs: Tx[],
  mappings: Record<string, string>
): {
  lines: { key: string; label: string; value: number; kind: "line" | "subtotal" | "result"; sign: 1 | -1 | 0 }[];
  buckets: Record<DreLineKey, number>;
  byCategory: { category: string; type: string; dreLine: DreLineKey; value: number; mapped: boolean }[];
  unmappedCategories: string[];
  margins: { bruta: number | null; operacional: number | null; liquida: number | null };
} {
  const buckets = Object.fromEntries(DRE_LINE_KEYS.map((k) => [k, 0])) as Record<DreLineKey, number>;
  const cat = new Map<string, { category: string; type: string; dreLine: DreLineKey; value: number; mapped: boolean }>();

  for (const t of txs) {
    const value = Number(t.amount) || 0;
    const mappedLine = mappings[t.category];
    const dreLine = (mappedLine && (DRE_LINE_KEYS as readonly string[]).includes(mappedLine)
      ? (mappedLine as DreLineKey)
      : classifyDreLine(t.type, t.category)) as DreLineKey;
    buckets[dreLine] += value;
    const k = `${t.type}:${t.category}`;
    const row = cat.get(k) ?? { category: t.category, type: t.type, dreLine, value: 0, mapped: Boolean(mappedLine) };
    row.value += value;
    row.dreLine = dreLine;
    row.mapped = Boolean(mappedLine);
    cat.set(k, row);
  }

  const receitaBruta = buckets.RECEITA_BRUTA;
  const deducoes = buckets.DEDUCOES;
  const receitaLiquida = receitaBruta - deducoes;
  const custo = buckets.CUSTO;
  const lucroBruto = receitaLiquida - custo;
  const despOperacionais = buckets.DESPESA_VENDAS + buckets.DESPESA_ADMIN + buckets.DESPESA_GERAL;
  const ebitda = lucroBruto - despOperacionaisSafe(despOperacionais);
  const ebit = ebitda - buckets.DEPRECIACAO;
  const resultadoFinanceiro = buckets.RECEITA_FINANCEIRA - buckets.DESPESA_FINANCEIRA;
  const lair = ebit + resultadoFinanceiro;
  const impostosRenda = buckets.IMPOSTOS_RENDA;
  const lucroLiquido = lair - impostosRenda;

  const lines: DreLine[] = ([
    { key: "RECEITA_BRUTA", label: DRE_LINE_LABEL.RECEITA_BRUTA, value: receitaBruta, kind: "line", sign: 1 },
    { key: "DEDUCOES", label: `(-) ${DRE_LINE_LABEL.DEDUCOES}`, value: deducoes, kind: "line", sign: -1 },
    { key: "RECEITA_LIQUIDA", label: "= Receita líquida", value: receitaLiquida, kind: "subtotal", sign: 0 },
    { key: "CUSTO", label: `(-) ${DRE_LINE_LABEL.CUSTO}`, value: custo, kind: "line", sign: -1 },
    { key: "LUCRO_BRUTO", label: "= Lucro bruto", value: lucroBruto, kind: "subtotal", sign: 0 },
    { key: "DESPESA_VENDAS", label: `(-) ${DRE_LINE_LABEL.DESPESA_VENDAS}`, value: buckets.DESPESA_VENDAS, kind: "line", sign: -1 },
    { key: "DESPESA_ADMIN", label: `(-) ${DRE_LINE_LABEL.DESPESA_ADMIN}`, value: buckets.DESPESA_ADMIN, kind: "line", sign: -1 },
    { key: "DESPESA_GERAL", label: `(-) ${DRE_LINE_LABEL.DESPESA_GERAL}`, value: buckets.DESPESA_GERAL, kind: "line", sign: -1 },
    { key: "EBITDA", label: "= Resultado operacional (EBITDA)", value: ebitda, kind: "subtotal", sign: 0 },
    { key: "DEPRECIACAO", label: `(-) ${DRE_LINE_LABEL.DEPRECIACAO}`, value: buckets.DEPRECIACAO, kind: "line", sign: -1 },
    { key: "EBIT", label: "= EBIT (resultado antes de juros e impostos)", value: ebit, kind: "subtotal", sign: 0 },
    { key: "RESULTADO_FINANCEIRO", label: "(+/-) Resultado financeiro", value: resultadoFinanceiro, kind: "line", sign: resultadoFinanceiro >= 0 ? 1 : -1 },
    { key: "LAIR", label: "= Resultado antes do IRPJ/CSLL (LAIR)", value: lair, kind: "subtotal", sign: 0 },
    { key: "IMPOSTOS_RENDA", label: `(-) ${DRE_LINE_LABEL.IMPOSTOS_RENDA}`, value: impostosRenda, kind: "line", sign: -1 },
    { key: "LUCRO_LIQUIDO", label: "= Lucro líquido do exercício", value: lucroLiquido, kind: "result", sign: 0 },
  ] as DreLine[]).map((l) => ({ ...l, value: Math.round(l.value * 100) / 100 }));

  const byCategory = [...cat.values()].map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 })).sort((a, b) => b.value - a.value);
  const unmappedCategories = [...new Set(byCategory.filter((r) => !r.mapped).map((r) => r.category))];

  const pct = (num: number) => (receitaLiquida > 0 ? Math.round((num / receitaLiquida) * 1000) / 10 : null);
  return {
    lines,
    buckets,
    byCategory,
    unmappedCategories,
    margins: { bruta: pct(lucroBruto), operacional: pct(ebitda), liquida: pct(lucroLiquido) },
  };
}

function despOperacionaisSafe(n: number) {
  return Number.isFinite(n) ? n : 0;
}
