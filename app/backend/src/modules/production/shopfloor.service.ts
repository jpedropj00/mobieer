/**
 * Chão de fábrica: os itens (módulos/peças) de um pedido percorrem os setores
 * na ordem abaixo, com apontamento por operador.
 */
export const PRODUCTION_SECTORS = [
  "CORTE",
  "FITA_BORDA",
  "FURACAO",
  "PRE_MONTAGEM",
  "EMBALAGEM",
  "EXPEDICAO",
] as const;
export type ProductionSector = (typeof PRODUCTION_SECTORS)[number];

export const SECTOR_LABEL: Record<ProductionSector, string> = {
  CORTE: "Corte",
  FITA_BORDA: "Fita de borda",
  FURACAO: "Furação",
  PRE_MONTAGEM: "Pré-montagem",
  EMBALAGEM: "Embalagem",
  EXPEDICAO: "Expedição",
};

export function sectorIndex(s: string) {
  return PRODUCTION_SECTORS.indexOf(s as ProductionSector);
}
export function nextSector(s: string): ProductionSector | null {
  const i = sectorIndex(s);
  return i >= 0 && i < PRODUCTION_SECTORS.length - 1 ? PRODUCTION_SECTORS[i + 1] : null;
}

export const itemInclude = {
  events: {
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { id: true, name: true } } },
  },
  order: { select: { id: true, projectId: true, project: { select: { id: true, code: true, name: true } } } },
  timeLogs: { select: { minutes: true, startedAt: true, endedAt: true } },
} as const;

type ItemRow = {
  id: string;
  ambiente: string | null;
  descricao: string;
  referencia: string | null;
  quantidade: number;
  material: string | null;
  status: string;
  sector: string | null;
  sourceImportId: string | null;
  position: number;
  notes: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  events?: {
    id: string;
    sector: string | null;
    action: string;
    note: string | null;
    createdAt: Date;
    createdBy?: { id: string; name: string } | null;
  }[];
  timeLogs?: { minutes: number | null; startedAt: Date; endedAt: Date | null }[];
  order?: { id: string; projectId: string; project?: { id: string; code: string; name: string } | null } | null;
};

const DAY = 86400000;
/** Quando o item entrou no setor atual = createdAt do último evento de movimento. */
const MOVE_ACTIONS = new Set(["ENTER", "JUMP", "REOPEN", "COMPLETE"]);
function enteredSectorAt(i: ItemRow): Date | null {
  if (i.status !== "IN_PROGRESS" || !i.sector) return null;
  const moves = (i.events ?? []).filter((e) => MOVE_ACTIONS.has(e.action));
  return moves.length ? moves[moves.length - 1].createdAt : i.startedAt;
}

export function serializeItem(i: ItemRow) {
  const enteredAt = enteredSectorAt(i);
  const daysInSector = enteredAt ? Math.floor((Date.now() - enteredAt.getTime()) / DAY) : null;
  const logs = i.timeLogs ?? [];
  const timeMinutes = logs.reduce(
    (s, l) => s + (l.minutes ?? (l.endedAt ? 0 : Math.round((Date.now() - l.startedAt.getTime()) / 60000))),
    0
  );
  const timerRunning = logs.some((l) => !l.endedAt);
  return {
    id: i.id,
    ambiente: i.ambiente,
    descricao: i.descricao,
    referencia: i.referencia,
    quantidade: i.quantidade,
    material: i.material,
    status: i.status,
    sector: i.sector,
    sectorLabel: i.sector ? SECTOR_LABEL[i.sector as ProductionSector] ?? i.sector : null,
    sectorIndex: i.sector ? sectorIndex(i.sector) : -1,
    nextSector: i.sector ? nextSector(i.sector) : i.status === "PENDING" ? PRODUCTION_SECTORS[0] : null,
    sourceImportId: i.sourceImportId,
    position: i.position,
    notes: i.notes,
    startedAt: i.startedAt,
    completedAt: i.completedAt,
    enteredSectorAt: enteredAt,
    daysInSector,
    timeMinutes,
    timerRunning,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    events:
      i.events?.map((e) => ({
        id: e.id,
        sector: e.sector,
        sectorLabel: e.sector ? SECTOR_LABEL[e.sector as ProductionSector] ?? e.sector : null,
        action: e.action,
        note: e.note,
        createdAt: e.createdAt,
        author: e.createdBy?.name ?? null,
      })) ?? [],
    project: i.order?.project
      ? { id: i.order.project.id, code: i.order.project.code, name: i.order.project.name }
      : undefined,
  };
}

/** Dias a partir dos quais um item "parado" no setor vira alerta. */
export const STALE_SECTOR_DAYS = 5;

type SerializedItem = ReturnType<typeof serializeItem>;

/**
 * Carga da fábrica: para cada setor, quantos itens estão nele agora, quantos
 * estão a caminho (setores anteriores + PENDING), e há quanto tempo os itens
 * estão parados (média / máximo / mais antigo). Espera itens já serializados,
 * apenas os ativos (não CANCELLED/DONE aparecem como carga; DONE é ignorado).
 */
export function computeFactoryLoad(items: SerializedItem[]) {
  const active = items.filter((i) => i.status === "IN_PROGRESS" || i.status === "PENDING");
  const pending = active.filter((i) => i.status === "PENDING").length;

  const sectors = PRODUCTION_SECTORS.map((sector, idx) => {
    const here = active.filter((i) => i.status === "IN_PROGRESS" && i.sector === sector);
    const upstream = active.filter(
      (i) => i.status === "PENDING" || (i.status === "IN_PROGRESS" && i.sectorIndex >= 0 && i.sectorIndex < idx)
    ).length;
    const days = here.map((i) => i.daysInSector ?? 0);
    const oldestItem = here.reduce<SerializedItem | null>(
      (acc, i) => (acc == null || (i.daysInSector ?? 0) > (acc.daysInSector ?? 0) ? i : acc),
      null
    );
    return {
      sector,
      label: SECTOR_LABEL[sector],
      count: here.length,
      upstream,
      stale: here.filter((i) => (i.daysInSector ?? 0) >= STALE_SECTOR_DAYS).length,
      avgDaysInSector: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0,
      maxDaysInSector: days.length ? Math.max(...days) : 0,
      oldest: oldestItem
        ? {
            id: oldestItem.id,
            descricao: oldestItem.descricao,
            projectCode: oldestItem.project?.code ?? null,
            daysInSector: oldestItem.daysInSector ?? 0,
          }
        : null,
    };
  });

  return {
    pending,
    inProgress: active.length - pending,
    staleTotal: sectors.reduce((n, s) => n + s.stale, 0),
    sectors,
  };
}

/** Resumo do pedido: contagem por status e por setor (para o painel do projeto). */
export function summarizeItems(items: { status: string; sector: string | null }[]) {
  const bySector: Record<string, number> = {};
  for (const s of PRODUCTION_SECTORS) bySector[s] = 0;
  let pending = 0;
  let done = 0;
  let cancelled = 0;
  for (const it of items) {
    if (it.status === "PENDING") pending++;
    else if (it.status === "DONE") done++;
    else if (it.status === "CANCELLED") cancelled++;
    else if (it.sector) bySector[it.sector] = (bySector[it.sector] ?? 0) + 1;
  }
  const active = items.length - cancelled;
  return {
    total: items.length,
    pending,
    inProgress: active - pending - done,
    done,
    cancelled,
    bySector,
    progress: active > 0 ? Math.round((done / active) * 100) : 0,
  };
}
