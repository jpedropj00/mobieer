/**
 * Desenho técnico por medidas: a pessoa informa largura, altura, topo, rodapé
 * e o que há em cada coluna (prateleiras, portas, gavetas) e o sistema monta a
 * vista frontal cotada — a prancha que antes só saía do Promob.
 *
 * Aqui ficam só as contas (em milímetros, origem embaixo à esquerda). Quem
 * desenha é o tech-drawing.pdf.ts.
 */

export const COLUMN_KINDS = ["PRATELEIRAS", "PORTAS", "GAVETAS", "VAO", "SAPATEIRA", "MALEIRO", "OUTROS"] as const;
/** Colunas divididas por prateleiras: N divisões dão N + 1 vãos (zero = um vão só, com o nome). */
export const SHELF_LIKE: readonly string[] = ["PRATELEIRAS", "SAPATEIRA", "MALEIRO", "OUTROS"];
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
  /** chamada própria desta coluna, ao lado do móvel (ex.: "PORTAS DE GIRO EM ALUMÍNIO PRATA L 1180 X A 2349") */
  note?: string | null;
};

export const DRAWING_LAYOUTS = ["VISTA", "PRANCHA"] as const;
export type DrawingImage = { storageKey: string; fileName: string; mime: string };
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
  /** fechamento (ou vista) lateral em mm: a tira de acabamento à esquerda e à direita do móvel */
  sideLeft?: number;
  sideRight?: number;
  columns: DrawingColumn[];
  layout?: (typeof DRAWING_LAYOUTS)[number];
  /** imagens 3D (render) que entram ao lado da vista cotada, na mesma folha */
  images?: { closed?: DrawingImage | null; open?: DrawingImage | null };
  /** espessura das chapas em mm */
  thickness?: number;
  finish?: (typeof DRAWING_FINISHES)[number];
  /** profundidade da prateleira */
  shelfDepth?: number | null;
  /** especificações do móvel (materiais, ferragens, puxador…) */
  specs?: string[];
};

export class DrawingError extends Error {}

/** Espessura padrão da chapa (prateleiras e caixaria), em mm. */
export const DEFAULT_THICKNESS = 15.5;

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
  /** cotas verticais da esquerda, de baixo para cima: rodapé, vãos e prateleiras (com a espessura), roda-teto */
  chain: { y0: number; y1: number; value: number }[];
  /** espessura da chapa usada nas prateleiras */
  thickness: number;
  /** fechamentos laterais (0 = não tem) */
  sideLeft: number;
  sideRight: number;
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

const DEFAULT_LABEL: Record<ColumnKind, string | null> = { PRATELEIRAS: "PRATELEIRA", GAVETAS: "GAVETA", PORTAS: null, VAO: null, SAPATEIRA: "SAPATEIRA", MALEIRO: "MALEIRO", OUTROS: "OUTROS" };

export function layoutDrawing(spec: DrawingSpec): DrawingLayout {
  const { width, height } = spec;
  const top = Math.max(0, spec.top || 0);
  const base = Math.max(0, spec.base || 0);
  if (!(width > 0) || !(height > 0)) throw new DrawingError("Informe a largura e a altura do móvel");
  if (!spec.columns.length) throw new DrawingError("Adicione pelo menos uma coluna");
  const inner = height - top - base;
  if (inner <= 0) throw new DrawingError("O roda-teto e o rodapé somam mais que a altura do móvel");
  const warnings: string[] = [];
  const t = spec.thickness && spec.thickness > 0 ? spec.thickness : DEFAULT_THICKNESS;
  const sideLeft = Math.max(0, spec.sideLeft || 0);
  const sideRight = Math.max(0, spec.sideRight || 0);
  // as colunas ocupam a largura que sobra entre os fechamentos laterais
  const usable = width - sideLeft - sideRight;
  if (usable <= 0) throw new DrawingError("Os fechamentos laterais somam mais que a largura do móvel");

  // larguras: as informadas ficam; o resto divide o que sobrar
  const given = spec.columns.reduce((s, c) => s + (c.width && c.width > 0 ? c.width : 0), 0);
  const free = spec.columns.filter((c) => !(c.width && c.width > 0)).length;
  const fit = sideLeft || sideRight ? `a largura do móvel sem os fechamentos (${mm(usable)} mm)` : `a largura do móvel (${mm(usable)} mm)`;
  if (given > usable + 0.5) throw new DrawingError(`As colunas somam ${mm(given)} mm, mais que ${fit}`);
  if (!free && Math.abs(given - usable) > 0.5) throw new DrawingError(`As colunas somam ${mm(given)} mm e não fecham com ${fit}. Ajuste, ou deixe uma coluna sem largura para ela ficar com o resto.`);
  const share = free ? (usable - given) / free : 0;

  let x = sideLeft;
  const columns: LaidColumn[] = spec.columns.map((c, i) => {
    const w = c.width && c.width > 0 ? c.width : share;
    const count = Math.max(0, Math.floor(c.count || 0));
    // em "Outros" o nome é o que a pessoa escreveu
    const label = c.label?.trim().toUpperCase() || DEFAULT_LABEL[c.kind];
    const inside = c.kind === "PORTAS" ? Math.max(0, Math.floor(c.shelves || 0)) : 0;
    const col: LaidColumn = { kind: c.kind, x, width: w, lines: [], bands: [], doors: c.kind === "PORTAS" ? Math.max(1, count) : 0, hidden: c.kind === "PORTAS" };
    x += w;
    const parts = SHELF_LIKE.includes(c.kind) ? count + 1 : c.kind === "GAVETAS" ? count : inside ? inside + 1 : 0;
    if (parts < 1) return col;

    // Entre dois vãos há uma prateleira, que ocupa a espessura da chapa. Gaveta não tem chapa entre as frentes.
    const boards = c.kind === "GAVETAS" ? 0 : parts - 1;
    const tb = boards * t;
    const avail = inner - tb;
    if (avail <= 0) throw new DrawingError(`Coluna ${i + 1}: ${boards} prateleiras de ${mm(t)} mm não cabem no vão interno (${mm(inner)} mm)`);

    // alturas dos vãos livres, de cima para baixo; faltando a última, ela fica com o resto
    let hs = c.heights.filter((h) => h > 0).slice(0, parts);
    if (hs.length === parts - 1) {
      const rest = avail - hs.reduce((s, h) => s + h, 0);
      if (rest <= 0) throw new DrawingError(`Coluna ${i + 1}: as alturas informadas já passam do que cabe (${mm(avail)} mm${boards ? `, descontadas as prateleiras` : ""})`);
      hs = [...hs, r1(rest)];
    } else if (hs.length !== parts) {
      if (hs.length) warnings.push(`Coluna ${i + 1}: eram esperadas ${parts} alturas e vieram ${hs.length}; dividi por igual.`);
      hs = Array.from({ length: parts }, () => r1(avail / parts));
    }
    const sum = hs.reduce((s, h) => s + h, 0);
    if (Math.abs(sum - avail) > 1)
      warnings.push(
        `Coluna ${i + 1}: as alturas somam ${mm(sum)} mm e cabem ${mm(avail)} mm${boards ? ` (vão interno de ${mm(inner)} mm menos ${boards} ${boards > 1 ? "prateleiras" : "prateleira"} de ${mm(t)} mm)` : ""} — diferença de ${mm(Math.abs(sum - avail))} mm. O desenho foi ajustado; as cotas saem como você digitou.`
      );

    // de baixo para cima, proporcional ao que cabe (a cota impressa é a digitada)
    const k = avail / sum;
    let y = base;
    const up = [...hs].reverse();
    up.forEach((h, j) => {
      const y1 = y + h * k;
      col.bands.push({ y0: y, y1, value: h, label: c.kind === "PORTAS" ? "PRATELEIRA" : label });
      y = y1;
      if (j < up.length - 1) {
        // a chapa da prateleira (centro em `lines`); entre gavetas é só a linha da frente
        col.lines.push(y + (boards ? t / 2 : 0));
        if (boards) y += t;
      }
    });
    return col;
  });

  // cotas da esquerda: a primeira coluna que tem vãos (de preferência, à vista)
  const ref = columns.find((c) => c.bands.length && !c.hidden) ?? columns.find((c) => c.bands.length);
  const inside: { y0: number; y1: number; value: number }[] = [];
  ref?.bands.forEach((b, j) => {
    // entre um vão e o seguinte fica a prateleira: a espessura dela também é cotada
    if (j > 0 && b.y0 - ref.bands[j - 1].y1 > 0.01) inside.push({ y0: ref.bands[j - 1].y1, y1: b.y0, value: t });
    inside.push({ y0: b.y0, y1: b.y1, value: b.value });
  });
  const chain = [
    ...(base > 0 ? [{ y0: 0, y1: base, value: base }] : []),
    ...(ref ? inside : [{ y0: base, y1: base + inner, value: inner }]),
    ...(top > 0 ? [{ y0: height - top, y1: height, value: top }] : []),
  ];

  const dims = `L ${mm(width)} X A ${mm(height)}${spec.depth && spec.depth > 0 ? ` X P ${mm(spec.depth)}` : ""}`;
  // quem já escreveu "L 1360 X A 2380" na descrição não recebe as medidas de novo
  const typedDims = /(^|\s)L\s*\d[\d.,]*\s*X\s*A\s*\d/i.test(spec.description);
  const callout = [...wrapWords(spec.description.trim().toUpperCase(), 26).slice(0, 4), ...(typedDims ? [] : [dims])];
  return { width, height, top, base, columns, chain, callout, warnings, thickness: t, sideLeft, sideRight };
}

export function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && `${cur} ${w}`.length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 10);
}
