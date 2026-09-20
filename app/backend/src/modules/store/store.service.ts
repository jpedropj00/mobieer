/**
 * Visão da loja: pipeline de ponta a ponta (pré-venda -> assistência), painel
 * comercial/financeiro e ponto de equilíbrio calculado dos lançamentos reais.
 *
 * As regras ficam em funções puras (sem banco) para serem testáveis.
 */
import { DRE_LINE_KEYS, classifyDreLine, type DreLineKey } from "../finance/dre.service";

const DAY_MS = 86400000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================ Pipeline ============================

export const PIPELINE_STAGES = [
  "PRE_VENDA",
  "MEDICAO",
  "PROJETO_TECNICO",
  "PRODUCAO",
  "ENTREGA_MONTAGEM",
  "POS_VENDA",
  "ASSISTENCIA",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_LABEL: Record<PipelineStage, string> = {
  PRE_VENDA: "Pré-venda",
  MEDICAO: "Medição",
  PROJETO_TECNICO: "Projeto técnico",
  PRODUCAO: "Produção",
  ENTREGA_MONTAGEM: "Entrega e montagem",
  POS_VENDA: "Pós-venda",
  ASSISTENCIA: "Assistência",
};

/** Dias parado na etapa a partir dos quais o card fica em alerta. */
export const PIPELINE_STALE_DAYS: Record<PipelineStage, number> = {
  PRE_VENDA: 7,
  MEDICAO: 7,
  PROJETO_TECNICO: 12,
  PRODUCAO: 30,
  ENTREGA_MONTAGEM: 7,
  POS_VENDA: 15,
  ASSISTENCIA: 5,
};

/** Pós-venda fica no quadro por este tempo depois da entrega. */
export const POST_SALE_WINDOW_DAYS = 30;

export type ProjectFacts = {
  projectStatus: string;
  createdAt: Date;
  completedAt: Date | null;
  measurement: { status: string; createdAt: Date; doneAt: Date | null } | null;
  techApproval: { status: string; createdAt: Date; approvedAt: Date | null } | null;
  production: {
    stage: string;
    releasedAt: Date | null;
    outForDeliveryAt: Date | null;
    deliveredAt: Date | null;
  } | null;
  pendingPostSale: boolean;
};

/**
 * Em que etapa da loja o projeto está, e desde quando. `null` = fora do quadro
 * (cancelado, ou concluído há mais tempo que a janela de pós-venda).
 */
export function deriveProjectStage(f: ProjectFacts, now = new Date()): { stage: PipelineStage; since: Date } | null {
  if (f.projectStatus === "CANCELLED") return null;

  const p = f.production;
  const delivered = p?.stage === "DELIVERED" ? p.deliveredAt ?? f.completedAt : f.projectStatus === "COMPLETED" ? f.completedAt : null;
  if (p?.stage === "DELIVERED" || f.projectStatus === "COMPLETED") {
    const since = delivered ?? f.createdAt;
    const recent = now.getTime() - since.getTime() <= POST_SALE_WINDOW_DAYS * DAY_MS;
    return f.pendingPostSale || recent ? { stage: "POS_VENDA", since } : null;
  }
  if (p?.stage === "OUT_FOR_DELIVERY") return { stage: "ENTREGA_MONTAGEM", since: p.outForDeliveryAt ?? p.releasedAt ?? f.createdAt };
  if (p && ["RELEASED", "IN_PRODUCTION", "PRE_ASSEMBLY"].includes(p.stage)) {
    return { stage: "PRODUCAO", since: p.releasedAt ?? f.createdAt };
  }
  if (f.techApproval && f.techApproval.status !== "APPROVED") return { stage: "PROJETO_TECNICO", since: f.techApproval.createdAt };
  if (f.techApproval?.status === "APPROVED") {
    // aprovado mas a ordem de produção ainda não foi aberta
    return { stage: "PRODUCAO", since: f.techApproval.approvedAt ?? f.techApproval.createdAt };
  }
  if (f.measurement?.status === "DONE") return { stage: "PROJETO_TECNICO", since: f.measurement.doneAt ?? f.measurement.createdAt };
  return { stage: "MEDICAO", since: f.measurement?.createdAt ?? f.createdAt };
}

export function daysSince(since: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

export function isStale(stage: PipelineStage, since: Date, now = new Date()) {
  return daysSince(since, now) >= PIPELINE_STALE_DAYS[stage];
}

// ============================ Ponto de equilíbrio ============================

/** Linhas da DRE que variam com a venda. O resto das despesas é custo fixo. */
export const VARIABLE_LINES: readonly DreLineKey[] = ["DEDUCOES", "CUSTO", "DESPESA_VENDAS"];
/** Despesas fixas (a estrutura que a loja paga vendendo ou não). */
export const FIXED_LINES: readonly DreLineKey[] = ["DESPESA_ADMIN", "DESPESA_GERAL", "DESPESA_FINANCEIRA", "DEPRECIACAO"];

export type BreakEvenTx = { type: string; category: string; amount: number };

export type BreakEvenInput = {
  /** Lançamentos PAGOS do período de referência. */
  transactions: BreakEvenTx[];
  /** Quantos meses o período de referência cobre (para tirar a média). */
  months: number;
  mappings?: Record<string, string>;
  /** Receita paga do mês corrente até agora. */
  currentMonthRevenue: number;
  /** Ticket médio das vendas (para "quantas vendas faltam"). */
  averageTicket: number | null;
  dayOfMonth: number;
  daysInMonth: number;
  override?: { fixedCostMonthly?: number | null; contributionMarginPct?: number | null };
};

function lineOf(t: BreakEvenTx, mappings: Record<string, string>): DreLineKey {
  const mapped = mappings[t.category];
  if (mapped && (DRE_LINE_KEYS as readonly string[]).includes(mapped)) return mapped as DreLineKey;
  return classifyDreLine(t.type, t.category);
}

export function computeBreakEven(input: BreakEvenInput) {
  const months = Math.max(1, input.months);
  const mappings = input.mappings ?? {};
  let revenue = 0;
  let variable = 0;
  let fixed = 0;
  const fixedByCategory = new Map<string, number>();
  const variableByCategory = new Map<string, number>();

  for (const t of input.transactions) {
    const amount = Number(t.amount) || 0;
    const line = lineOf(t, mappings);
    if (t.type === "RECEITA") {
      if (line === "RECEITA_BRUTA") revenue += amount;
      else if (line === "DEDUCOES") revenue -= amount; // devoluções/abatimentos
      continue; // receita financeira não entra
    }
    if (VARIABLE_LINES.includes(line)) {
      variable += amount;
      variableByCategory.set(t.category, (variableByCategory.get(t.category) ?? 0) + amount);
    } else if (FIXED_LINES.includes(line)) {
      fixed += amount;
      fixedByCategory.set(t.category, (fixedByCategory.get(t.category) ?? 0) + amount);
    }
    // IRPJ/CSLL dependem do lucro: não entram no ponto de equilíbrio operacional.
  }

  const revenueAvg = revenue / months;
  const variableAvg = variable / months;
  const calculatedFixed = fixed / months;
  const calculatedMargin = revenueAvg > 0 ? ((revenueAvg - variableAvg) / revenueAvg) * 100 : null;

  const fixedCostMonthly = input.override?.fixedCostMonthly ?? calculatedFixed;
  const contributionMarginPct = input.override?.contributionMarginPct ?? calculatedMargin;

  const warnings: string[] = [];
  if (!input.transactions.length) warnings.push("Sem lançamentos pagos no período de referência.");
  if (contributionMarginPct !== null && contributionMarginPct <= 0) {
    warnings.push("Margem de contribuição zerada ou negativa: os custos variáveis consomem toda a receita.");
  }
  if (revenueAvg <= 0 && input.override?.contributionMarginPct == null) {
    warnings.push("Sem receita no período de referência para calcular a margem.");
  }

  const breakEvenRevenue = contributionMarginPct && contributionMarginPct > 0 ? fixedCostMonthly / (contributionMarginPct / 100) : null;

  const current = input.currentMonthRevenue;
  const projected = input.dayOfMonth > 0 ? (current / input.dayOfMonth) * input.daysInMonth : current;
  const ticket = input.averageTicket && input.averageTicket > 0 ? input.averageTicket : null;
  const missing = breakEvenRevenue !== null ? Math.max(0, breakEvenRevenue - current) : null;

  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([category, total]) => ({ category, monthly: round2(total / months) }))
      .sort((a, b) => b.monthly - a.monthly)
      .slice(0, 8);

  return {
    source: {
      fixedCost: input.override?.fixedCostMonthly != null ? ("MANUAL" as const) : ("CALCULADO" as const),
      margin: input.override?.contributionMarginPct != null ? ("MANUAL" as const) : ("CALCULADO" as const),
    },
    referenceMonths: months,
    averageMonthlyRevenue: round2(revenueAvg),
    averageMonthlyVariableCost: round2(variableAvg),
    fixedCostMonthly: round2(fixedCostMonthly),
    calculatedFixedCostMonthly: round2(calculatedFixed),
    contributionMarginPct: contributionMarginPct === null ? null : round2(contributionMarginPct),
    calculatedContributionMarginPct: calculatedMargin === null ? null : round2(calculatedMargin),
    breakEvenRevenue: breakEvenRevenue === null ? null : round2(breakEvenRevenue),
    currentMonthRevenue: round2(current),
    projectedMonthRevenue: round2(projected),
    progressPct: breakEvenRevenue ? round2((current / breakEvenRevenue) * 100) : null,
    missingRevenue: missing === null ? null : round2(missing),
    reached: breakEvenRevenue !== null && current >= breakEvenRevenue,
    projectedToReach: breakEvenRevenue !== null && projected >= breakEvenRevenue,
    averageTicket: ticket === null ? null : round2(ticket),
    salesNeededPerMonth: breakEvenRevenue !== null && ticket ? Math.ceil(breakEvenRevenue / ticket) : null,
    salesStillNeeded: missing !== null && ticket ? Math.ceil(missing / ticket) : null,
    topFixedCosts: top(fixedByCategory),
    topVariableCosts: top(variableByCategory),
    warnings,
  };
}

// ============================ Datas do painel ============================

/** Início do mês (horário de Fortaleza, UTC-3) em UTC. */
export function fortalezaMonthStart(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex, 1, 3, 0, 0, 0));
}

/** Ano/mês/dia correntes em Fortaleza. */
export function fortalezaToday(now = new Date()) {
  const [y, m, d] = now.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" }).split("-").map(Number);
  return { year: y, monthIndex: m - 1, day: d, daysInMonth: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? null : 0;
  return round2(((current - previous) / previous) * 100);
}
