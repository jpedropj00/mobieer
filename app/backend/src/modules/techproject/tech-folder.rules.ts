/**
 * Pasta técnica (projeto executivo) montada pelo sistema: capa com índice,
 * especificação por ambiente (vinda do orçamento aprovado) e as pranchas —
 * imagens ou páginas exportadas do Promob — cada uma com o carimbo da loja
 * (cliente, ambiente, logotipo), título e escala, como no modelo
 * "PROJETO EXECUTIVO VARANDA".
 */

import type { DrawingSpec } from "./tech-drawing.rules";

export type TechSheet = {
  id: string;
  room: string;
  title: string;
  scale: string | null;
  /** Observação em destaque na prancha (ex.: "P.D: 2656mm"). */
  note: string | null;
  storageKey: string;
  fileName: string;
  mime: string;
  /** Página do PDF enviado (0 = primeira); nulo para imagem. */
  page: number | null;
  /** Desenha o carimbo da loja. Página de PDF que já veio carimbada do Promob entra como está. */
  stamp: boolean;
  /** Prancha desenhada pelo sistema a partir das medidas (dá para editar e gerar de novo). */
  drawing?: DrawingSpec;
};

export type TechFolderData = { sheets: TechSheet[]; includeSpecs: boolean; notes: string[] };

export const SHEET_TITLES = ["PLANTA BAIXA", "VISTA A", "VISTA A INTERNA", "VISTA B", "VISTA B INTERNA", "VISTA C", "PERSPECTIVA", "DETALHE"];
export const SCALES = ["1:10", "1:20", "1:25", "1:50"];

/** Título sugerido pelo nome do arquivo: "vista a interna.png" → "VISTA A INTERNA". */
export function titleFromFile(fileName: string, index: number): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const known = [...SHEET_TITLES].sort((a, b) => b.length - a.length).find((t) => base.includes(t));
  if (known) return known;
  if (/PLANTA/.test(base)) return "PLANTA BAIXA";
  if (/PERSP|3D|RENDER/.test(base)) return "PERSPECTIVA";
  if (/VISTA|ELEVA/.test(base)) return "VISTA";
  return `PRANCHA ${index + 1}`;
}

/** Encaixa w×h dentro da caixa, centralizado, sem distorcer. */
export function fitRect(w: number, h: number, box: { x: number; y: number; w: number; h: number }) {
  const k = Math.min(box.w / w, box.h / h);
  const fw = w * k;
  const fh = h * k;
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Pranchas agrupadas por ambiente, na ordem em que foram colocadas. */
export function sheetsByRoom(sheets: TechSheet[]): { room: string; sheets: TechSheet[] }[] {
  const map = new Map<string, { room: string; sheets: TechSheet[] }>();
  for (const s of sheets) {
    const k = clean(s.room).toLowerCase();
    if (!map.has(k)) map.set(k, { room: clean(s.room) || "Geral", sheets: [] });
    map.get(k)!.sheets.push(s);
  }
  return [...map.values()];
}

export type SpecItem = { room: string | null; description: string; corpo?: string | null; porta?: string | null; puxador?: string | null; complemento?: string | null; modelo?: string | null };
export type SpecBlock = { room: string; rows: { label: string; value: string }[]; description: string | null };

const SPEC_FIELDS: [keyof SpecItem, string][] = [
  ["corpo", "Caixaria"],
  ["porta", "Portas e frentes"],
  ["puxador", "Puxador"],
  ["complemento", "Complemento"],
  ["modelo", "Modelo"],
];

/** Especificação por ambiente a partir dos itens do orçamento; ambiente sem nenhum dado fica de fora. */
export function specBlocks(items: SpecItem[]): SpecBlock[] {
  const map = new Map<string, SpecBlock>();
  for (const it of items) {
    const room = clean(it.room) || clean(it.description);
    if (!room) continue;
    const k = room.toLowerCase();
    const b = map.get(k) ?? { room, rows: [], description: null };
    for (const [f, label] of SPEC_FIELDS) {
      const value = clean(it[f] as string | null);
      if (value && !b.rows.some((r) => r.label === label)) b.rows.push({ label, value });
    }
    const desc = clean(it.room) ? clean(it.description) : "";
    if (desc && !b.description) b.description = desc;
    map.set(k, b);
  }
  return [...map.values()].filter((b) => b.rows.length || b.description);
}

/** Índice da capa: número da folha de cada prancha, contando capa e especificação. */
export function sheetIndex(sheets: TechSheet[], specPages: number): { n: number; room: string; title: string }[] {
  const first = 2 + specPages;
  return sheetsByRoom(sheets)
    .flatMap((g) => g.sheets)
    .map((s, i) => ({ n: first + i, room: clean(s.room) || "Geral", title: s.title }));
}
