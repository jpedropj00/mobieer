/**
 * Desenho técnico por medidas: a pessoa informa largura, altura, topo, rodapé
 * e o que há em cada coluna (prateleiras, portas, gavetas) e o sistema monta a
 * vista frontal cotada — a prancha que antes só saía do Promob.
 *
 * Aqui ficam só as contas (em milímetros, origem embaixo à esquerda). Quem
 * desenha é o tech-drawing.pdf.ts.
 */

export const COLUMN_KINDS = ["PRATELEIRAS", "PORTAS", "GAVETAS", "VAO"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export type DrawingColumn = {
  kind: ColumnKind;
  /** largura da coluna em mm; vazio = divide o que sobrar por igual */
  width: number | null;
  /** nº de prateleiras, de portas ou de gavetas */
  count: number;
  /** alturas dos vãos (prateleiras) ou das frentes (gavetas), de cima para baixo; vazio = iguais */
  heights: number[];
  /** texto dentro da coluna (padrão: PRATELEIRA / GAVETA) */
  label: string | null;
  /** coluna de portas: nº de prateleiras atrás delas (as alturas vão em `heights`) */
  shelves?: number;
};

export const DRAWING_LAYOUTS = ["VISTA", "PRANCHA"] as const;
export const DRAWING_FINISHES = ["MADEIRA", "BRANCO", "CINZA", "PRETO"] as const;

export type DrawingSpec = {
  /** texto da chamada, ex.: "ARMÁRIO COM CAIXARIA EM MDF CINZA URBAN" */
  description: string;
  width: number;
  height: number;
  depth: number | null;
  /** faixa superior (roda-teto / régua) em mm */
  top: number;
  /** rodapé em mm */
  base: number;
  columns: DrawingColumn[];
  /** VISTA = só a vista cotada; PRANCHA = folha completa (perspectivas, vistas, especificações) */
  layout?: (typeof DRAWING_LAYOUTS)[number];
  /** espessura das chapas em mm (prancha completa) */
  thickness?: number;
  /** cor de fora do móvel na prancha completa */
  finish?: (typeof DRAWING_FINISHES)[number];
  /** profundidade da prateleira; sem ela a peça sai sem essa cota */
  shelfDepth?: number | null;
  /** linhas do quadro de especificações */
  specs?: string[];
};

export class DrawingError extends Error {}

export type LaidColumn = {
  kind: ColumnKind;
  x: number;
  width: number;
  /** linhas horizontais dentro da coluna (y a partir do chão) */
  lines: number[];
  /** faixas com rótulo e a medida informada, de baixo para cima */
  bands: { y0: number; y1: number; value: number; label: string | null }[];
  /** nº de portas (divisões verticais) */
  doors: number;
  /** as faixas ficam atrás das portas: só aparecem na vista interna */
  hidden: boolean;
};

export type DrawingLayout = {
  width: number;
  height: number;
  top: number;
  base: number;
  columns: LaidColumn[];
  /** cotas verticais da esquerda, de baixo para cima: rodapé, vãos, topo */
  chain: { y0: number; y1: number; value: number }[];
  /** linha de chamada: descrição + "L x A x P" */
  callout: string[];
  /** avisos que não impedem o desenho (ex.: alturas não fecham com o vão) */
  warnings: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 378.5 → "378,5"; 2380 → "2380" */
export function mm(n: number): string {
  const v = r1(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ",");
}

/** "378,5; 378.5 / 400" → [378.5, 378.5, 400] */
export function parseHeights(text: string | null | undefined): number[] {
  return (text ?? "")
    .split(/[;\/\n|]+|\s+(?=\d)/)
    .map((p) => Number(p.trim().replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const DEFAULT_LABEL: Record<ColumnKind, string | null> = { PRATELEIRAS: "PRATELEIRA", GAVETAS: "GAVETA", PORTAS: null, VAO: null };

export function layoutDrawing(spec: DrawingSpec): DrawingLayout {
  const { width, height } = spec;
  const top = Math.max(0, spec.top || 0);
  const base = Math.max(0, spec.base || 0);
  if (!(width > 0) || !(height > 0)) throw new DrawingError("Informe a largura e a altura do móvel");
  if (!spec.columns.length) throw new DrawingError("Adicione pelo menos uma coluna");
  const inner = height - top - base;
  if (inner <= 0) throw new DrawingError("O topo e o rodapé somam mais que a altura do móvel");
  const warnings: string[] = [];

  // larguras: as informadas ficam; o resto divide o que sobrar
  const given = spec.columns.reduce((s, c) => s + (c.width && c.width > 0 ? c.width : 0), 0);
  const free = spec.columns.filter((c) => !(c.width && c.width > 0)).length;
  if (given > width + 0.5) throw new DrawingError(`As colunas somam ${mm(given)} mm, mais que a largura do móvel (${mm(width)} mm)`);
  if (!free && Math.abs(given - width) > 0.5) throw new DrawingError(`As colunas somam ${mm(given)} mm e a largura do móvel é ${mm(width)} mm. Ajuste, ou deixe uma coluna sem largura para ela ficar com o resto.`);
  const share = free ? (width - given) / free : 0;

  let x = 0;
  const columns: LaidColumn[] = spec.columns.map((c, i) => {
    const w = c.width && c.width > 0 ? c.width : share;
    const count = Math.max(0, Math.floor(c.count || 0));
    const label = c.label?.trim() || DEFAULT_LABEL[c.kind];
    const inside = c.kind === "PORTAS" ? Math.max(0, Math.floor(c.shelves || 0)) : 0;
    const col: LaidColumn = { kind: c.kind, x, width: w, lines: [], bands: [], doors: c.kind === "PORTAS" ? Math.max(1, count) : 0, hidden: c.kind === "PORTAS" };
    x += w;
    const parts = c.kind === "PRATELEIRAS" ? count + 1 : c.kind === "GAVETAS" ? count : inside ? inside + 1 : 0;
    if (parts < 1) return col;

    // alturas de cima para baixo; faltando a última, ela fica com o resto
    let hs = c.heights.filter((h) => h > 0).slice(0, parts);
    if (hs.length === parts - 1) {
      const rest = inner - hs.reduce((s, h) => s + h, 0);
      if (rest <= 0) throw new DrawingError(`Coluna ${i + 1}: as alturas informadas já passam do vão interno (${mm(inner)} mm)`);
      hs = [...hs, r1(rest)];
    } else if (hs.length !== parts) {
      if (hs.length) warnings.push(`Coluna ${i + 1}: eram esperadas ${parts} alturas e vieram ${hs.length}; dividi por igual.`);
      hs = Array.from({ length: parts }, () => r1(inner / parts));
    }
    const sum = hs.reduce((s, h) => s + h, 0);
    if (Math.abs(sum - inner) > 1) warnings.push(`Coluna ${i + 1}: as alturas somam ${mm(sum)} mm e o vão interno é ${mm(inner)} mm (diferença de ${mm(Math.abs(sum - inner))} mm). O desenho foi ajustado; as cotas saem como você digitou.`);

    // de baixo para cima, proporcional ao vão (a cota impressa é a digitada)
    const k = inner / sum;
    let y = base;
    for (const h of [...hs].reverse()) {
      const y1 = y + h * k;
      col.bands.push({ y0: y, y1, value: h, label: c.kind === "PORTAS" ? "PRATELEIRA" : label });
      if (y1 < base + inner - 0.01) col.lines.push(y1);
      y = y1;
    }
    return col;
  });

  // cotas da esquerda: a primeira coluna que tem vãos (de preferência, à vista)
  const ref = columns.find((c) => c.bands.length && !c.hidden) ?? columns.find((c) => c.bands.length);
  const chain = [
    ...(base > 0 ? [{ y0: 0, y1: base, value: base }] : []),
    ...(ref ? ref.bands.map((b) => ({ y0: b.y0, y1: b.y1, value: b.value })) : [{ y0: base, y1: base + inner, value: inner }]),
    ...(top > 0 ? [{ y0: height - top, y1: height, value: top }] : []),
  ];

  const dims = `L ${mm(width)} X A ${mm(height)}${spec.depth && spec.depth > 0 ? ` X P ${mm(spec.depth)}` : ""}`;
  const callout = [...wrapWords(spec.description.trim().toUpperCase(), 26), dims];
  return { width, height, top, base, columns, chain, callout, warnings };
}

function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && `${cur} ${w}`.length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
