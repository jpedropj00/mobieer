/**
 * Projeto que já estava em andamento antes do sistema: a loja informa em que
 * etapa ele está, as anteriores ficam concluídas e o fluxo segue dali.
 */
import { StageStatus, TimelineStageKey } from "@prisma/client";

/** Etapas em que dá para começar: as do fluxo normal, sem garantia nem assistência. */
export const START_STAGES: TimelineStageKey[] = [
  TimelineStageKey.LEAD,
  TimelineStageKey.BRIEFING,
  TimelineStageKey.ORCAMENTO,
  TimelineStageKey.NEGOCIACAO,
  TimelineStageKey.CONTRATO,
  TimelineStageKey.PAGAMENTO_ENTRADA,
  TimelineStageKey.MEDICAO,
  TimelineStageKey.PROJETO_TECNICO,
  TimelineStageKey.APROVACAO,
  TimelineStageKey.TERMO_PRODUCAO,
  TimelineStageKey.PRODUCAO,
  TimelineStageKey.PRE_MONTAGEM,
  TimelineStageKey.ENTREGA,
  TimelineStageKey.MONTAGEM,
  TimelineStageKey.VISTORIA,
];

/** Etapa da fábrica que corresponde a cada etapa do projeto; nulo = ainda não tem pedido de produção. */
const PRODUCTION_STAGE: Partial<Record<TimelineStageKey, "IN_PRODUCTION" | "PRE_ASSEMBLY" | "OUT_FOR_DELIVERY" | "DELIVERED">> = {
  PRODUCAO: "IN_PRODUCTION",
  PRE_MONTAGEM: "PRE_ASSEMBLY",
  ENTREGA: "OUT_FOR_DELIVERY",
  MONTAGEM: "OUT_FOR_DELIVERY",
  VISTORIA: "DELIVERED",
};

export type StartAtPlan = {
  /** Etapas anteriores que ainda não estavam concluídas. */
  conclude: TimelineStageKey[];
  /** A etapa atual passa a "em andamento" (nulo se já estava em andamento ou concluída). */
  start: TimelineStageKey | null;
  productionStage: "IN_PRODUCTION" | "PRE_ASSEMBLY" | "OUT_FOR_DELIVERY" | "DELIVERED" | null;
};

/**
 * O que precisa mudar para o projeto ficar na etapa `target`.
 * Nunca volta etapa: o que já está concluído ou marcado "não se aplica" fica como está.
 */
export function startAtPlan(stages: { key: TimelineStageKey; status: StageStatus }[], target: TimelineStageKey): StartAtPlan {
  const idx = START_STAGES.indexOf(target);
  if (idx < 0) throw new Error("Etapa inválida para começar o projeto");
  const status = new Map(stages.map((s) => [s.key, s.status]));
  const settled = (k: TimelineStageKey) => status.get(k) === StageStatus.CONCLUIDA || status.get(k) === StageStatus.NAO_APLICAVEL;
  const conclude = START_STAGES.slice(0, idx).filter((k) => status.has(k) && !settled(k));
  const cur = status.get(target);
  const start = cur === StageStatus.PENDENTE || cur === StageStatus.BLOQUEADA ? target : null;
  return { conclude, start, productionStage: PRODUCTION_STAGE[target] ?? null };
}
