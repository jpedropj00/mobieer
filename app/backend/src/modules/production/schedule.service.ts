import { aiEnabled, aiJson } from "../../lib/ai";
import { PRODUCTION_STAGES, STAGE_LABEL, type ProductionStage } from "./production.service";

const DAY = 86400000;

export type ScheduleStep = {
  stage: ProductionStage;
  label: string;
  startAt: string; // ISO date (yyyy-mm-dd)
  endAt: string;
  durationDays: number;
  note?: string | null;
};
export type ProductionSchedule = {
  source: "AI" | "HEURISTIC";
  generatedAt: string;
  summary: string | null;
  deliveryAt: string;
  steps: ScheduleStep[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

// Durações padrão (dias corridos) de cada etapa da esteira.
const DEFAULT_DURATION: Record<Exclude<ProductionStage, "RELEASED">, number> = {
  IN_PRODUCTION: 18,
  PRE_ASSEMBLY: 3,
  OUT_FOR_DELIVERY: 2,
  DELIVERED: 0,
};

type ProjectCtx = {
  code: string;
  name: string;
  description?: string | null;
  releasedAt?: Date | null;
  estimatedDeliveryAt?: Date | null;
  measurementDoneAt?: Date | null;
  itemHints?: string[]; // ex.: ambientes do projeto / itens do Promob
};

/** Gera um cronograma heurístico distribuindo as etapas a partir de hoje/liberação. */
export function heuristicSchedule(ctx: ProjectCtx): ProductionSchedule {
  const base = new Date(Math.max(Date.now(), ctx.releasedAt?.getTime() ?? 0));
  base.setHours(0, 0, 0, 0);

  let durations = { ...DEFAULT_DURATION };
  // Se há previsão de entrega, escala as etapas para caber na janela.
  if (ctx.estimatedDeliveryAt) {
    const totalWanted = Math.max(1, Math.round((ctx.estimatedDeliveryAt.getTime() - base.getTime()) / DAY));
    const totalDefault = durations.IN_PRODUCTION + durations.PRE_ASSEMBLY + durations.OUT_FOR_DELIVERY;
    const factor = totalWanted / totalDefault;
    durations = {
      IN_PRODUCTION: Math.max(5, Math.round(durations.IN_PRODUCTION * factor)),
      PRE_ASSEMBLY: Math.max(1, Math.round(durations.PRE_ASSEMBLY * factor)),
      OUT_FOR_DELIVERY: Math.max(1, Math.round(durations.OUT_FOR_DELIVERY * factor)),
      DELIVERED: 0,
    };
  }

  const steps: ScheduleStep[] = [];
  let cursor = base;
  for (const stage of PRODUCTION_STAGES) {
    if (stage === "RELEASED") {
      steps.push({ stage, label: STAGE_LABEL[stage], startAt: iso(cursor), endAt: iso(cursor), durationDays: 0, note: "Projeto técnico aprovado" });
      continue;
    }
    if (stage === "DELIVERED") {
      steps.push({ stage, label: STAGE_LABEL[stage], startAt: iso(cursor), endAt: iso(cursor), durationDays: 0, note: null });
      continue;
    }
    const dur = durations[stage];
    const start = cursor;
    const end = addDays(cursor, dur);
    steps.push({ stage, label: STAGE_LABEL[stage], startAt: iso(start), endAt: iso(end), durationDays: dur, note: null });
    cursor = end;
  }

  return {
    source: "HEURISTIC",
    generatedAt: new Date().toISOString(),
    summary: "Cronograma estimado automaticamente a partir das durações padrão de produção.",
    deliveryAt: iso(cursor),
    steps,
  };
}

type AiRaw = { summary?: string; steps?: { stage?: string; startAt?: string; endAt?: string; note?: string }[] };

/** Usa a IA quando configurada; cai no heurístico em qualquer falha. */
export async function generateSchedule(ctx: ProjectCtx): Promise<ProductionSchedule> {
  if (!aiEnabled()) return heuristicSchedule(ctx);

  const today = iso(new Date());
  try {
    const raw = await aiJson<AiRaw>({
      system:
        "Você é um PCP de uma fábrica de móveis planejados. Gere um cronograma de produção realista, " +
        "em dias corridos, cobrindo as etapas na ordem: IN_PRODUCTION (produção na fábrica), " +
        "PRE_ASSEMBLY (pré-montagem/conferência), OUT_FOR_DELIVERY (entrega e montagem). " +
        'Responda SOMENTE JSON no formato {"summary": string, "steps": [{"stage": "IN_PRODUCTION"|"PRE_ASSEMBLY"|"OUT_FOR_DELIVERY", "startAt": "yyyy-mm-dd", "endAt": "yyyy-mm-dd", "note": string}]}.',
      prompt: [
        `Data de hoje: ${today}.`,
        ctx.releasedAt ? `Projeto liberado para produção em ${iso(ctx.releasedAt)}.` : "",
        ctx.measurementDoneAt ? `Medição concluída em ${iso(ctx.measurementDoneAt)}.` : "",
        ctx.estimatedDeliveryAt ? `Previsão de entrega desejada: ${iso(ctx.estimatedDeliveryAt)}.` : "Sem previsão de entrega definida.",
        `Projeto ${ctx.code} — ${ctx.name}.`,
        ctx.description ? `Escopo: ${ctx.description}` : "",
        ctx.itemHints?.length ? `Ambientes/itens: ${ctx.itemHints.join(", ")}.` : "",
        "Comece a produção na data de liberação ou hoje, o que for mais tarde.",
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 900,
    });

    const order: Exclude<ProductionStage, "RELEASED" | "DELIVERED">[] = ["IN_PRODUCTION", "PRE_ASSEMBLY", "OUT_FOR_DELIVERY"];
    const base = new Date(Math.max(Date.now(), ctx.releasedAt?.getTime() ?? 0));
    base.setHours(0, 0, 0, 0);

    const steps: ScheduleStep[] = [{ stage: "RELEASED", label: STAGE_LABEL.RELEASED, startAt: iso(base), endAt: iso(base), durationDays: 0, note: "Projeto técnico aprovado" }];
    let cursor = base;
    for (const stage of order) {
      const m = (raw.steps ?? []).find((s) => (s.stage ?? "").toUpperCase() === stage);
      const start = m?.startAt && !Number.isNaN(Date.parse(m.startAt)) ? new Date(m.startAt) : cursor;
      let end = m?.endAt && !Number.isNaN(Date.parse(m.endAt)) ? new Date(m.endAt) : addDays(start, DEFAULT_DURATION[stage]);
      if (end < start) end = addDays(start, DEFAULT_DURATION[stage]);
      const durationDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY));
      steps.push({ stage, label: STAGE_LABEL[stage], startAt: iso(start), endAt: iso(end), durationDays, note: m?.note?.trim() || null });
      cursor = end;
    }
    steps.push({ stage: "DELIVERED", label: STAGE_LABEL.DELIVERED, startAt: iso(cursor), endAt: iso(cursor), durationDays: 0, note: null });

    return {
      source: "AI",
      generatedAt: new Date().toISOString(),
      summary: raw.summary?.trim() || null,
      deliveryAt: iso(cursor),
      steps,
    };
  } catch (e) {
    console.warn(`[production] IA de cronograma falhou, usando heurístico: ${e instanceof Error ? e.message : e}`);
    return heuristicSchedule(ctx);
  }
}
