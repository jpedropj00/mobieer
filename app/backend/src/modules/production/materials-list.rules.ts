/**
 * Lista de materiais a comprar por cliente: o que hoje vai num papel
 * ("MATERIAIS — semana 05/10": cliente → ambiente → chapa (qtd) ✓).
 * A lista nasce do arquivo do Promob (chapas por ambiente e fitas) e pode ser
 * completada à mão; cada linha é marcada como comprada ou não.
 */

export type MaterialUnit = "chapa" | "m" | "un";

export type MaterialLine = {
  id: string;
  room: string;
  material: string;
  qty: number | null;
  unit: MaterialUnit;
  bought: boolean;
  boughtAt?: string | null;
  boughtBy?: string | null;
  note?: string | null;
  /** PROMOB = veio do arquivo; MANUAL = digitada */
  source: "PROMOB" | "MANUAL";
};

export type MaterialDraft = Pick<MaterialLine, "room" | "material" | "qty" | "unit">;

type Peca = { material: string | null; ambiente: string | null; areaM2: number | null; chapa?: { x: number; y: number } | null };
type PromobLike = {
  pecas?: Peca[];
  materiais?: { material: string; areaM2: number; chapaM2?: number | null; chapas?: number | null }[];
  fitas?: { fita: string; metros: number }[];
};

export const NO_ROOM = "Geral";
export const EDGE_ROOM = "Fitas de borda";
/** Mesma perda de corte usada na estimativa de chapas da importação. */
const CUT_LOSS = 0.1;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
export const lineKey = (l: { room: string; material: string; unit: MaterialUnit }) => `${clean(l.room).toLowerCase()}|${clean(l.material).toLowerCase()}|${l.unit}`;

/**
 * Chapas por ambiente e material, a partir das peças do Promob.
 * Sem o tamanho da chapa não dá para estimar: a quantidade fica em branco.
 */
export function draftsFromPromob(parsed: PromobLike | null | undefined): MaterialDraft[] {
  if (!parsed) return [];
  const out: MaterialDraft[] = [];
  const groups = new Map<string, { room: string; material: string; area: number; chapaM2: number | null }>();
  for (const p of parsed.pecas ?? []) {
    const material = clean(p.material);
    if (!material) continue;
    const room = clean(p.ambiente) || NO_ROOM;
    const k = `${room.toLowerCase()}|${material.toLowerCase()}`;
    const g = groups.get(k) ?? { room, material, area: 0, chapaM2: null };
    g.area += p.areaM2 ?? 0;
    if (!g.chapaM2 && p.chapa) g.chapaM2 = (p.chapa.x * p.chapa.y) / 1_000_000;
    groups.set(k, g);
  }
  const sheetOf = new Map((parsed.materiais ?? []).map((m) => [clean(m.material).toLowerCase(), m.chapaM2 ?? null]));
  for (const g of groups.values()) {
    const chapaM2 = g.chapaM2 ?? sheetOf.get(g.material.toLowerCase()) ?? null;
    const qty = chapaM2 && g.area > 0 ? Math.ceil((g.area * (1 + CUT_LOSS)) / chapaM2 - 1e-9) : null;
    out.push({ room: g.room, material: g.material, qty, unit: "chapa" });
  }
  // arquivo sem peça por ambiente: usa o resumo por material
  if (!groups.size) {
    for (const m of parsed.materiais ?? []) {
      if (clean(m.material)) out.push({ room: NO_ROOM, material: clean(m.material), qty: m.chapas ?? null, unit: "chapa" });
    }
  }
  for (const f of parsed.fitas ?? []) {
    if (clean(f.fita) && f.metros > 0) out.push({ room: EDGE_ROOM, material: clean(f.fita), qty: Math.ceil(f.metros), unit: "m" });
  }
  return out;
}

/**
 * Junta a lista salva com o que veio do Promob: linha que já existe mantém a
 * marcação de comprado (só a quantidade é atualizada, e só se ainda não foi
 * comprada); linha nova entra; linha digitada à mão nunca é removida.
 * Linha do Promob que sumiu do arquivo sai, a não ser que já esteja comprada.
 */
export function mergeDrafts(existing: MaterialLine[], drafts: MaterialDraft[], newId: () => string): MaterialLine[] {
  const incoming = new Map(drafts.map((d) => [lineKey(d), d]));
  const out: MaterialLine[] = [];
  const seen = new Set<string>();
  for (const l of existing) {
    const k = lineKey(l);
    const d = incoming.get(k);
    if (d) {
      seen.add(k);
      out.push(l.bought ? l : { ...l, qty: d.qty ?? l.qty });
    } else if (l.source === "MANUAL" || l.bought) {
      out.push(l);
    }
  }
  for (const [k, d] of incoming) {
    if (!seen.has(k)) out.push({ id: newId(), room: clean(d.room) || NO_ROOM, material: clean(d.material), qty: d.qty, unit: d.unit, bought: false, source: "PROMOB" });
  }
  return out;
}

export function summary(lines: MaterialLine[]) {
  const bought = lines.filter((l) => l.bought).length;
  return { total: lines.length, bought, pending: lines.length - bought, done: lines.length > 0 && bought === lines.length };
}

/** Agrupa por ambiente, na ordem em que aparecem; fitas por último. */
export function groupByRoom<T extends { room: string }>(lines: T[]): { room: string; lines: T[] }[] {
  const map = new Map<string, { room: string; lines: T[] }>();
  for (const l of lines) {
    const k = clean(l.room).toLowerCase();
    if (!map.has(k)) map.set(k, { room: clean(l.room) || NO_ROOM, lines: [] });
    map.get(k)!.lines.push(l);
  }
  const groups = [...map.values()];
  return [...groups.filter((g) => g.room !== EDGE_ROOM), ...groups.filter((g) => g.room === EDGE_ROOM)];
}

export function qtyText(l: Pick<MaterialLine, "qty" | "unit">): string {
  if (l.qty == null) return "";
  if (l.unit === "m") return `${l.qty} m`;
  if (l.unit === "chapa") return `${l.qty} ${l.qty === 1 ? "chapa" : "chapas"}`;
  return `${l.qty} un`;
}
