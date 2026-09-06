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
  order?: { id: string; projectId: string; project?: { id: string; code: string; name: string } | null } | null;
};

export function serializeItem(i: ItemRow) {
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
