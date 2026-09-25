/**
 * Timeline central do projeto: as 17 etapas do ciclo, do lead à assistência.
 *
 * Funções puras, sem banco. A timeline nasce dos dados que o sistema já tem
 * (lead, briefing, orçamento, contrato, medição, aprovação, produção,
 * montagem, assistência) e depois passa a ser das pessoas: o que alguém
 * marcou à mão nunca é desfeito por uma derivação automática.
 *
 * Regras que valem a pena ler antes de mexer:
 *
 * 1. Etapa posterior concluída implica as anteriores concluídas. Um projeto em
 *    produção passou por contrato, mesmo que o contrato não tenha sido anexado.
 *    Essas etapas "implícitas" ficam CONCLUIDA **sem data** — o sistema não
 *    inventa quando algo aconteceu.
 * 2. "Atrasada" não é gravada: sai de plannedAt + status na leitura, como no
 *    financeiro. Assim não fica defasada se o job diário não rodar.
 * 3. A sincronização automática só avança. Nunca volta uma etapa, nunca mexe
 *    em etapa que uma pessoa já alterou.
 */
import { StageStatus, TimelineStageKey } from "@prisma/client";
import { ValidationError } from "../../utils/ApiError";

export const TIMELINE_STAGES = [
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
  TimelineStageKey.GARANTIA,
  TimelineStageKey.ASSISTENCIA,
] as const;

export const STAGE_LABEL: Record<TimelineStageKey, string> = {
  LEAD: "Lead",
  BRIEFING: "Briefing",
  ORCAMENTO: "Orçamento",
  NEGOCIACAO: "Negociação",
  CONTRATO: "Contrato",
  PAGAMENTO_ENTRADA: "Pagamento / entrada",
  MEDICAO: "Medição",
  PROJETO_TECNICO: "Projeto técnico",
  APROVACAO: "Aprovação",
  TERMO_PRODUCAO: "Termo de produção",
  PRODUCAO: "Produção",
  PRE_MONTAGEM: "Pré-montagem",
  ENTREGA: "Entrega",
  MONTAGEM: "Montagem",
  VISTORIA: "Vistoria",
  GARANTIA: "Garantia",
  ASSISTENCIA: "Assistência",
};

/** Quem normalmente cuida de cada etapa — base para sugerir o responsável. */
export const STAGE_AREA: Record<TimelineStageKey, "COMERCIAL" | "FINANCEIRO" | "PROJETOS" | "PRODUCAO" | "MONTAGEM" | "POS_VENDA"> = {
  LEAD: "COMERCIAL",
  BRIEFING: "COMERCIAL",
  ORCAMENTO: "COMERCIAL",
  NEGOCIACAO: "COMERCIAL",
  CONTRATO: "COMERCIAL",
  PAGAMENTO_ENTRADA: "FINANCEIRO",
  MEDICAO: "PROJETOS",
  PROJETO_TECNICO: "PROJETOS",
  APROVACAO: "PROJETOS",
  TERMO_PRODUCAO: "PROJETOS",
  PRODUCAO: "PRODUCAO",
  PRE_MONTAGEM: "PRODUCAO",
  ENTREGA: "MONTAGEM",
  MONTAGEM: "MONTAGEM",
  VISTORIA: "POS_VENDA",
  GARANTIA: "POS_VENDA",
  ASSISTENCIA: "POS_VENDA",
};

/**
 * Etapas em sequência. Garantia e assistência não entram: garantia é um
 * período que começa depois da vistoria, e assistência pode acontecer várias
 * vezes, a qualquer momento depois da entrega.
 */
export const SEQUENTIAL_STAGES = TIMELINE_STAGES.slice(0, TIMELINE_STAGES.indexOf(TimelineStageKey.GARANTIA));

export const positionOf = (key: TimelineStageKey) => TIMELINE_STAGES.indexOf(key);

// ---------------------------------------------------------------------------
// Derivação a partir dos dados reais
// ---------------------------------------------------------------------------

/** O que o sistema já sabe sobre o projeto, vindo de cada módulo. */
export type TimelineFacts = {
  projectCreatedAt: Date;
  projectStatus: string; // PLANNING | ACTIVE | ON_HOLD | COMPLETED | CANCELLED
  leadAt?: Date | null;
  briefingAt?: Date | null;
  quoteAt?: Date | null;
  wonAt?: Date | null; // oportunidade ganha = negociação encerrada
  contractSignedAt?: Date | null;
  contractSentAt?: Date | null;
  entryPaidAt?: Date | null;
  measurement?: { status: string; createdAt: Date; doneAt: Date | null } | null;
  techApproval?: { status: string; publishedAt: Date | null; approvedAt: Date | null } | null;
  production?: {
    stage: string; // DRAFT | RELEASED | IN_PRODUCTION | PRE_ASSEMBLY | OUT_FOR_DELIVERY | DELIVERED
    releasedAt: Date | null;
    preAssemblyAt?: Date | null;
    outForDeliveryAt: Date | null;
    deliveredAt: Date | null;
  } | null;
  installation?: { startedAt: Date | null; finishedAt: Date | null; allDone: boolean } | null;
  inspectionDoneAt?: Date | null;
  warrantyEndsAt?: Date | null;
  assistance?: { open: number; total: number; lastOpenedAt: Date | null } | null;
};

export type DerivedStage = {
  key: TimelineStageKey;
  status: StageStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  /** true quando a etapa só foi dada como concluída porque uma posterior foi. */
  implied: boolean;
};

const PRODUCTION_ORDER = ["DRAFT", "RELEASED", "IN_PRODUCTION", "PRE_ASSEMBLY", "OUT_FOR_DELIVERY", "DELIVERED"];
const productionAtLeast = (stage: string | undefined, min: string) =>
  stage !== undefined && PRODUCTION_ORDER.indexOf(stage) >= PRODUCTION_ORDER.indexOf(min);

/**
 * Para cada etapa sequencial: a data em que ela foi concluída, se houver
 * evidência. `true` = concluída mas sem data conhecida.
 */
function completionEvidence(f: TimelineFacts): Partial<Record<TimelineStageKey, Date | true>> {
  const p = f.production;
  const ev: Partial<Record<TimelineStageKey, Date | true>> = {};
  if (f.leadAt) ev.LEAD = f.leadAt;
  if (f.briefingAt) ev.BRIEFING = f.briefingAt;
  if (f.quoteAt) ev.ORCAMENTO = f.quoteAt;
  if (f.wonAt) ev.NEGOCIACAO = f.wonAt;
  if (f.contractSignedAt) ev.CONTRATO = f.contractSignedAt;
  if (f.entryPaidAt) ev.PAGAMENTO_ENTRADA = f.entryPaidAt;
  if (f.measurement?.status === "DONE") ev.MEDICAO = f.measurement.doneAt ?? true;
  if (f.techApproval && f.techApproval.status !== "DRAFT") ev.PROJETO_TECNICO = f.techApproval.publishedAt ?? true;
  if (f.techApproval?.status === "APPROVED") ev.APROVACAO = f.techApproval.approvedAt ?? true;
  if (p && productionAtLeast(p.stage, "RELEASED")) ev.TERMO_PRODUCAO = p.releasedAt ?? true;
  if (p && productionAtLeast(p.stage, "PRE_ASSEMBLY")) ev.PRODUCAO = p.preAssemblyAt ?? true;
  if (p && productionAtLeast(p.stage, "OUT_FOR_DELIVERY")) ev.PRE_MONTAGEM = p.outForDeliveryAt ?? true;
  if (p && productionAtLeast(p.stage, "DELIVERED")) ev.ENTREGA = p.deliveredAt ?? true;
  if (f.installation?.allDone) ev.MONTAGEM = f.installation.finishedAt ?? true;
  if (f.inspectionDoneAt) ev.VISTORIA = f.inspectionDoneAt;
  // projeto marcado como concluído encerra o fluxo até a vistoria
  if (f.projectStatus === "COMPLETED" && !ev.VISTORIA) ev.VISTORIA = true;
  return ev;
}

/** Quando a etapa atual começou, se o sistema souber. */
function startEvidence(key: TimelineStageKey, f: TimelineFacts): Date | null {
  switch (key) {
    case TimelineStageKey.LEAD:
      return f.leadAt ?? f.projectCreatedAt;
    case TimelineStageKey.MEDICAO:
      return f.measurement?.createdAt ?? null;
    case TimelineStageKey.PRODUCAO:
      return f.production?.releasedAt ?? null;
    case TimelineStageKey.MONTAGEM:
      return f.installation?.startedAt ?? null;
    default:
      return null;
  }
}

/** Deriva as 17 etapas a partir dos fatos. */
export function deriveTimeline(f: TimelineFacts): DerivedStage[] {
  const ev = completionEvidence(f);
  const cancelled = f.projectStatus === "CANCELLED";

  // a etapa concluída mais adiante define até onde o projeto chegou
  let lastDone = -1;
  SEQUENTIAL_STAGES.forEach((key, i) => {
    if (ev[key] !== undefined) lastDone = i;
  });

  const out: DerivedStage[] = SEQUENTIAL_STAGES.map((key, i) => {
    const evidence = ev[key];
    if (i <= lastDone) {
      return {
        key,
        status: StageStatus.CONCLUIDA,
        startedAt: null,
        completedAt: evidence instanceof Date ? evidence : null,
        implied: evidence === undefined,
      };
    }
    if (i === lastDone + 1 && !cancelled) {
      return { key, status: StageStatus.EM_ANDAMENTO, startedAt: startEvidence(key, f), completedAt: null, implied: false };
    }
    return { key, status: cancelled ? StageStatus.NAO_APLICAVEL : StageStatus.PENDENTE, startedAt: null, completedAt: null, implied: false };
  });

  // Garantia: só existe depois da vistoria; fica "em andamento" enquanto vigente.
  const vistoriaFeita = lastDone >= positionOf(TimelineStageKey.VISTORIA);
  const garantiaVencida = f.warrantyEndsAt ? f.warrantyEndsAt.getTime() < Date.now() : false;
  out.push({
    key: TimelineStageKey.GARANTIA,
    status: !vistoriaFeita || cancelled ? StageStatus.NAO_APLICAVEL : garantiaVencida ? StageStatus.CONCLUIDA : StageStatus.EM_ANDAMENTO,
    startedAt: vistoriaFeita && ev.VISTORIA instanceof Date ? ev.VISTORIA : null,
    completedAt: garantiaVencida ? f.warrantyEndsAt! : null,
    implied: false,
  });

  // Assistência: não se aplica até existir o primeiro chamado.
  const a = f.assistance;
  out.push({
    key: TimelineStageKey.ASSISTENCIA,
    status: !a || a.total === 0 ? StageStatus.NAO_APLICAVEL : a.open > 0 ? StageStatus.EM_ANDAMENTO : StageStatus.CONCLUIDA,
    startedAt: a?.lastOpenedAt ?? null,
    completedAt: null,
    implied: false,
  });

  return out;
}

// ---------------------------------------------------------------------------
// Leitura: atraso, etapa atual e percentual
// ---------------------------------------------------------------------------

const FORTALEZA_TZ = "America/Fortaleza";
const todayKey = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: FORTALEZA_TZ });
// data prevista é data de calendário: lida em UTC, como o vencimento do financeiro
const dateKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "UTC" });

const CLOSED: StageStatus[] = [StageStatus.CONCLUIDA, StageStatus.NAO_APLICAVEL];

/** Etapa atrasada: tinha data prevista, a data passou e ela não foi encerrada. */
export function isOverdue(stage: { status: StageStatus; plannedAt: Date | null }, now = new Date()): boolean {
  if (!stage.plannedAt || CLOSED.includes(stage.status)) return false;
  return dateKey(stage.plannedAt) < todayKey(now);
}

type StageLike = { key: TimelineStageKey; status: StageStatus };

/** A etapa em que o projeto está: a primeira sequencial que não foi encerrada. */
export function currentStage<T extends StageLike>(stages: T[]): T | null {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  for (const key of SEQUENTIAL_STAGES) {
    const s = byKey.get(key);
    if (s && !CLOSED.includes(s.status)) return s;
  }
  return null;
}

/**
 * Percentual aproximado, para o portal do cliente. Conta só as etapas em
 * sequência: garantia e assistência não são "progresso" da obra.
 */
export function progressPercent(stages: StageLike[]): number {
  const seq = stages.filter((s) => (SEQUENTIAL_STAGES as readonly TimelineStageKey[]).includes(s.key));
  const applicable = seq.filter((s) => s.status !== StageStatus.NAO_APLICAVEL);
  if (!applicable.length) return 0;
  const done = applicable.filter((s) => s.status === StageStatus.CONCLUIDA).length;
  return Math.round((done / applicable.length) * 100);
}

// ---------------------------------------------------------------------------
// Sincronização: só avança, nunca pisa em decisão humana
// ---------------------------------------------------------------------------

export type PersistedStage = {
  key: TimelineStageKey;
  status: StageStatus;
  completedAt: Date | null;
  startedAt: Date | null;
  /** true se alguém já mudou o status desta etapa à mão */
  manuallyEdited: boolean;
};

const RANK: Record<StageStatus, number> = {
  PENDENTE: 0,
  BLOQUEADA: 0,
  EM_ANDAMENTO: 1,
  CONCLUIDA: 2,
  NAO_APLICAVEL: 2,
};

/**
 * O que a sincronização automática pode mudar. Só avança (pendente → em
 * andamento → concluída), e só em etapa que ninguém editou à mão.
 */
export function syncPlan(
  persisted: PersistedStage[],
  derived: DerivedStage[]
): { key: TimelineStageKey; status: StageStatus; startedAt: Date | null; completedAt: Date | null; from: StageStatus }[] {
  const byKey = new Map(persisted.map((p) => [p.key, p]));
  const plan: ReturnType<typeof syncPlan> = [];
  for (const d of derived) {
    const p = byKey.get(d.key);
    if (!p || p.manuallyEdited) continue;
    if (p.status === StageStatus.BLOQUEADA) continue; // bloqueio é sempre decisão de alguém
    if (d.status === p.status) continue;
    // "Não se aplica" gravado pela própria derivação quer dizer "ainda não":
    // garantia antes da vistoria, assistência antes do primeiro chamado. Quando
    // o fato acontece, a etapa precisa poder começar. (Marcado à mão já saiu acima.)
    const atual = p.status === StageStatus.NAO_APLICAVEL ? -1 : RANK[p.status];
    if (RANK[d.status] <= atual) continue; // nunca volta nem fica igual
    plan.push({
      key: d.key,
      status: d.status,
      startedAt: p.startedAt ?? d.startedAt,
      completedAt: d.status === StageStatus.CONCLUIDA ? p.completedAt ?? d.completedAt : null,
      from: p.status,
    });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Edição manual
// ---------------------------------------------------------------------------

export type StagePatch = {
  status?: StageStatus;
  responsibleId?: string | null;
  plannedAt?: Date | null;
  completedAt?: Date | null;
  notes?: string | null;
};

/**
 * Valida uma edição da etapa e devolve os campos a gravar, com as datas que
 * o status implica (concluir sem data real usa agora; reabrir limpa a data).
 */
export function applyStagePatch(
  current: { status: StageStatus; startedAt: Date | null; completedAt: Date | null },
  patch: StagePatch,
  now = new Date()
) {
  if (patch.completedAt && patch.completedAt.getTime() > now.getTime() + 86_400_000) {
    throw new ValidationError("A data real de conclusão não pode estar no futuro");
  }
  if (patch.completedAt && patch.status && patch.status !== StageStatus.CONCLUIDA) {
    throw new ValidationError("Só uma etapa concluída tem data real de conclusão");
  }

  const next = patch.status ?? current.status;
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.responsibleId !== undefined) data.responsibleId = patch.responsibleId;
  if (patch.plannedAt !== undefined) data.plannedAt = patch.plannedAt;
  if (patch.notes !== undefined) data.notes = patch.notes;

  if (next === StageStatus.CONCLUIDA) {
    data.completedAt = patch.completedAt ?? current.completedAt ?? now;
  } else if (patch.status !== undefined) {
    data.completedAt = null; // reaberta
  }
  if (next === StageStatus.EM_ANDAMENTO && !current.startedAt) data.startedAt = now;
  return data;
}

/** Diferença campo a campo, para o histórico. Só o que mudou de verdade. */
export function diffForHistory(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { field: string; fromValue: string | null; toValue: string | null }[] {
  const str = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  return Object.keys(after)
    .filter((k) => str(before[k]) !== str(after[k]))
    .map((k) => ({ field: k, fromValue: str(before[k]), toValue: str(after[k]) }));
}
