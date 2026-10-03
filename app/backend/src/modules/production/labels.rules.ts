/**
 * Etiquetas da produção e leitura do código de barras.
 *
 * Cada item (peça ou módulo) tem um código numérico único na organização. A
 * etiqueta sai com o código em Code 128; o leitor (que digita o código e dá
 * Enter) dá baixa no item. Item sem baixa aparece em vermelho na conferência,
 * mas não trava a produção. Regras puras.
 */
import { PRODUCTION_SECTORS, SECTOR_LABEL, nextSector, type ProductionSector } from "./shopfloor.service";

export const FIRST_CODE = 10_000_001;

/** Próximos `n` códigos depois do maior já usado. */
export function nextCodes(maxExisting: string | null | undefined, n: number): string[] {
  const max = maxExisting && /^\d+$/.test(maxExisting) ? Number(maxExisting) : 0;
  const start = Math.max(max + 1, FIRST_CODE);
  return Array.from({ length: n }, (_, i) => String(start + i));
}

/** O que o leitor mandou: só os dígitos (leitores podem pôr prefixo, sufixo ou espaço). */
export function normalizeScan(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 4 && digits.length <= 14 ? digits : null;
}

export type ScanMode = "done" | "advance";

export type ScanOutcome =
  | { kind: "ERROR"; message: string }
  | { kind: "ALREADY"; message: string }
  | { kind: "MOVE"; status: "IN_PROGRESS" | "DONE"; sector: ProductionSector | null; event: "ENTER" | "COMPLETE"; eventSector: ProductionSector | null; message: string };

/**
 * `done`: a leitura dá baixa — o item fica pronto, em qualquer setor que esteja.
 * `advance`: a leitura conclui o setor atual e manda para o próximo.
 */
export function scanOutcome(item: { status: string; sector: string | null }, mode: ScanMode): ScanOutcome {
  if (item.status === "CANCELLED") return { kind: "ERROR", message: "Item cancelado — reabra o item para dar baixa" };
  if (item.status === "DONE") return { kind: "ALREADY", message: "Este item já tinha baixa" };
  if (mode === "done") {
    return { kind: "MOVE", status: "DONE", sector: null, event: "COMPLETE", eventSector: (item.sector as ProductionSector | null) ?? null, message: "Baixa registrada" };
  }
  if (item.status === "PENDING" || !item.sector) {
    const first = PRODUCTION_SECTORS[0];
    return { kind: "MOVE", status: "IN_PROGRESS", sector: first, event: "ENTER", eventSector: first, message: `Entrou em ${SECTOR_LABEL[first]}` };
  }
  const next = nextSector(item.sector);
  const cur = item.sector as ProductionSector;
  return next
    ? { kind: "MOVE", status: "IN_PROGRESS", sector: next, event: "COMPLETE", eventSector: cur, message: `${SECTOR_LABEL[cur]} concluído — segue para ${SECTOR_LABEL[next]}` }
    : { kind: "MOVE", status: "DONE", sector: null, event: "COMPLETE", eventSector: cur, message: "Último setor concluído — item pronto" };
}

/** Conferência: quantos têm baixa e quantos faltam (cancelado não conta). */
export function checklistSummary(items: { status: string }[]) {
  const valid = items.filter((i) => i.status !== "CANCELLED");
  const done = valid.filter((i) => i.status === "DONE").length;
  return { total: valid.length, done, missing: valid.length - done, percent: valid.length ? Math.round((done / valid.length) * 100) : 0 };
}

/** "720 × 560 × 15 mm" a partir das medidas da peça. */
export function measuresText(p: { comprimento?: number | null; largura?: number | null; espessura?: number | null }): string | null {
  const dims = [p.comprimento, p.largura, p.espessura].filter((v): v is number => typeof v === "number" && v > 0).map((v) => String(Math.round(v * 10) / 10).replace(".", ","));
  return dims.length >= 2 ? `${dims.join(" × ")} mm` : null;
}

const MM = 72 / 25.4;
export type LabelFormat = "a4" | "termica";

/**
 * Posição das etiquetas na folha.
 * a4: folha de 24 etiquetas adesivas de 70 × 37 mm (3 × 8, sem margens).
 * termica: rolo de 100 × 50 mm, uma etiqueta por página.
 */
export function labelLayout(format: LabelFormat) {
  if (format === "termica") {
    const w = 100 * MM;
    const h = 50 * MM;
    return { page: [w, h] as [number, number], perPage: 1, cells: [{ x: 0, y: 0, w, h }], pad: 9 };
  }
  const w = 70 * MM;
  const h = 37.125 * MM;
  const cells = Array.from({ length: 24 }, (_, i) => ({ x: (i % 3) * w, y: Math.floor(i / 3) * h, w, h }));
  return { page: [210 * MM, 297 * MM] as [number, number], perPage: 24, cells, pad: 11 };
}
