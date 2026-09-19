/**
 * Regras da solicitação de peças do montador externo.
 *
 * Funções puras, sem banco: o fluxo de 12 status é a parte que mais quebra se
 * alguém mexer sem teste, então ele mora aqui e é coberto isoladamente.
 */
import { PartRequestStatus } from "@prisma/client";
import { ForbiddenError, ValidationError } from "../../utils/ApiError";

export const PART_STATUSES = [
  PartRequestStatus.RASCUNHO,
  PartRequestStatus.ENVIADA,
  PartRequestStatus.EM_ANALISE,
  PartRequestStatus.APROVADA,
  PartRequestStatus.RECUSADA,
  PartRequestStatus.EM_PRODUCAO,
  PartRequestStatus.PRONTA,
  PartRequestStatus.EM_TRANSPORTE,
  PartRequestStatus.ENTREGUE,
  PartRequestStatus.INSTALADA,
  PartRequestStatus.CONCLUIDA,
  PartRequestStatus.CANCELADA,
] as const;

export const STATUS_LABEL: Record<PartRequestStatus, string> = {
  RASCUNHO: "Rascunho",
  ENVIADA: "Enviada",
  EM_ANALISE: "Em análise",
  APROVADA: "Aprovada",
  RECUSADA: "Recusada",
  EM_PRODUCAO: "Em produção",
  PRONTA: "Pronta",
  EM_TRANSPORTE: "Em transporte",
  ENTREGUE: "Entregue",
  INSTALADA: "Instalada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

/** Status que encerram a solicitação: dali não sai mais. */
export const FINAL_STATUSES: PartRequestStatus[] = [
  PartRequestStatus.CONCLUIDA,
  PartRequestStatus.RECUSADA,
  PartRequestStatus.CANCELADA,
];

export const isFinal = (s: PartRequestStatus) => FINAL_STATUSES.includes(s);

/**
 * Para onde cada status pode ir. O caminho feliz é linear; recusa e
 * cancelamento são as saídas laterais.
 */
export const ALLOWED_TRANSITIONS: Record<PartRequestStatus, PartRequestStatus[]> = {
  RASCUNHO: [PartRequestStatus.ENVIADA, PartRequestStatus.CANCELADA],
  ENVIADA: [PartRequestStatus.EM_ANALISE, PartRequestStatus.APROVADA, PartRequestStatus.RECUSADA, PartRequestStatus.CANCELADA],
  EM_ANALISE: [PartRequestStatus.APROVADA, PartRequestStatus.RECUSADA, PartRequestStatus.CANCELADA],
  APROVADA: [PartRequestStatus.EM_PRODUCAO, PartRequestStatus.CANCELADA],
  EM_PRODUCAO: [PartRequestStatus.PRONTA, PartRequestStatus.CANCELADA],
  PRONTA: [PartRequestStatus.EM_TRANSPORTE, PartRequestStatus.ENTREGUE, PartRequestStatus.CANCELADA],
  EM_TRANSPORTE: [PartRequestStatus.ENTREGUE, PartRequestStatus.CANCELADA],
  ENTREGUE: [PartRequestStatus.INSTALADA, PartRequestStatus.CONCLUIDA],
  INSTALADA: [PartRequestStatus.CONCLUIDA],
  // finais
  CONCLUIDA: [],
  RECUSADA: [],
  CANCELADA: [],
};

/** Permissão exigida para cada destino. */
export const TRANSITION_PERMISSION: Record<PartRequestStatus, string[]> = {
  RASCUNHO: ["parts.create"],
  ENVIADA: ["parts.create"],
  EM_ANALISE: ["parts.analyze"],
  APROVADA: ["parts.analyze"],
  RECUSADA: ["parts.analyze"],
  EM_PRODUCAO: ["parts.produce"],
  PRONTA: ["parts.produce"],
  EM_TRANSPORTE: ["parts.deliver"],
  ENTREGUE: ["parts.deliver"],
  INSTALADA: ["parts.deliver", "parts.create"],
  CONCLUIDA: ["parts.deliver", "parts.analyze"],
  CANCELADA: ["parts.cancel"],
};

export type Actor = { id: string; permissions: string[] };

const has = (actor: Actor, code: string) => actor.permissions.includes(code);
const hasAny = (actor: Actor, codes: string[]) => codes.some((c) => has(actor, c));

/**
 * Valida a mudança de status: o caminho existe, a pessoa pode fazer, e a
 * recusa traz o motivo (a equipe precisa saber por que a peça não vem).
 */
export function assertTransition(
  from: PartRequestStatus,
  to: PartRequestStatus,
  actor: Actor,
  opts: { refusalReason?: string | null } = {}
) {
  if (from === to) throw new ValidationError(`A solicitação já está em "${STATUS_LABEL[to]}"`);
  if (isFinal(from)) {
    throw new ValidationError(`Solicitação ${STATUS_LABEL[from].toLowerCase()} não muda mais de status`, { from, to });
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const possiveis = ALLOWED_TRANSITIONS[from].map((s) => STATUS_LABEL[s]).join(", ") || "nenhum";
    throw new ValidationError(`De "${STATUS_LABEL[from]}" não dá para ir para "${STATUS_LABEL[to]}". Possíveis: ${possiveis}`, { from, to });
  }
  if (!hasAny(actor, TRANSITION_PERMISSION[to])) {
    throw new ForbiddenError(`Você não tem permissão para mover a solicitação para "${STATUS_LABEL[to]}"`);
  }
  if (to === PartRequestStatus.RECUSADA && !opts.refusalReason?.trim()) {
    throw new ValidationError("Informe o motivo da recusa — quem pediu a peça precisa saber por quê");
  }
}

/** Carimbos de data que cada status preenche. */
export function timestampsFor(to: PartRequestStatus, now = new Date()): Record<string, Date> {
  switch (to) {
    case PartRequestStatus.ENVIADA:
      return { submittedAt: now };
    case PartRequestStatus.EM_ANALISE:
      return { analyzedAt: now };
    case PartRequestStatus.APROVADA:
      return { approvedAt: now };
    case PartRequestStatus.RECUSADA:
      return { refusedAt: now };
    case PartRequestStatus.ENTREGUE:
      return { deliveredAt: now };
    case PartRequestStatus.CONCLUIDA:
      return { completedAt: now };
    case PartRequestStatus.CANCELADA:
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * O montador externo só enxerga o que é dele. Quem tem parts.read.all vê tudo.
 */
export function canSee(
  req: { createdById: string; contractorId: string | null },
  actor: Actor & { contractorId?: string | null }
): boolean {
  if (has(actor, "parts.read.all")) return true;
  if (req.createdById === actor.id) return true;
  return Boolean(actor.contractorId && req.contractorId === actor.contractorId);
}

export function assertCanSee(
  req: { createdById: string; contractorId: string | null },
  actor: Actor & { contractorId?: string | null }
) {
  if (!canSee(req, actor)) throw new ForbiddenError("Esta solicitação é de outro montador");
}

/** Rascunho só é editável por quem criou (ou por quem gerencia tudo). */
export function assertCanEdit(
  req: { status: PartRequestStatus; createdById: string; contractorId: string | null },
  actor: Actor & { contractorId?: string | null }
) {
  assertCanSee(req, actor);
  if (req.status !== PartRequestStatus.RASCUNHO && !has(actor, "parts.analyze")) {
    throw new ValidationError("Depois de enviada, a solicitação só é alterada pela equipe que analisa");
  }
  if (isFinal(req.status)) throw new ValidationError(`Solicitação ${STATUS_LABEL[req.status].toLowerCase()} não pode ser alterada`);
}

/** Uma solicitação sem peça nenhuma não pode ser enviada. */
export function assertSubmittable(itemCount: number) {
  if (itemCount < 1) throw new ValidationError("Adicione ao menos uma peça antes de enviar");
}

export type PartItemInput = {
  name: string;
  quantity: number;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  thickness?: number | null;
};

const MAX_MM = 10_000; // 10 metros: acima disso é erro de digitação (cm no lugar de mm)

/** Confere quantidade e dimensões da peça. Dimensões em milímetros. */
export function validateItem(item: PartItemInput, indice = 0) {
  const onde = `Peça ${indice + 1}${item.name ? ` (${item.name})` : ""}`;
  if (!item.name?.trim()) throw new ValidationError(`${onde}: informe o nome da peça`);
  if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new ValidationError(`${onde}: a quantidade precisa ser 1 ou mais`);
  if (item.quantity > 9999) throw new ValidationError(`${onde}: quantidade acima do razoável (${item.quantity})`);
  for (const [campo, valor] of [
    ["largura", item.width],
    ["altura", item.height],
    ["profundidade", item.depth],
    ["espessura", item.thickness],
  ] as const) {
    if (valor == null) continue;
    if (!(valor > 0)) throw new ValidationError(`${onde}: ${campo} precisa ser maior que zero`);
    if (valor > MAX_MM) throw new ValidationError(`${onde}: ${campo} de ${valor}mm parece errada — as medidas são em milímetros`);
  }
}

/**
 * Dados extraídos da etiqueta por OCR/IA. Ficam guardados, mas só entram na
 * peça depois que uma pessoa confirma — a especificação pede confirmação
 * explícita, e leitura de etiqueta erra.
 */
export type OcrSuggestion = { code?: string; name?: string; width?: number; height?: number; depth?: number; thickness?: number };

export function assertOcrConfirmed(photo: { ocrConfirmedAt: Date | null; ocrJson: unknown }) {
  if (!photo.ocrJson) throw new ValidationError("Esta foto não tem leitura automática para aplicar");
  if (!photo.ocrConfirmedAt) throw new ValidationError("Confirme a leitura da etiqueta antes de usá-la na peça");
}

/** Número sequencial no formato SOL-00001. */
export const formatNumber = (n: number) => `SOL-${String(n).padStart(5, "0")}`;
