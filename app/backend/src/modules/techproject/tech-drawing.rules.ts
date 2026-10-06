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
  /**
   * Mais de uma coisa na mesma coluna, de cima para baixo (ex.: maleiro, prateleiras,
   * gavetas). Com `parts`, os campos de tipo acima valem só como a primeira parte.
   */
  parts?: DrawingPart[];
};

/** Um trecho da coluna: o que tem ali e quanto ocupa de altura. */
export type DrawingPart = {
  kind: ColumnKind;
  count: number;
  heights: number[];
  label: string | null;
  shelves?: number;
  /** altura do trecho em mm; vazio = fica com o que sobrar na coluna */
  height?: number | null;
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
  /** os trechos da coluna, de baixo para cima (um só, na coluna simples) */
  parts: LaidPart[];
  /** chapas que separam um trecho do outro (centro, a partir do chão) */
  separators: number[];
};

export type LaidPart = {
  kind: ColumnKind;
  y0: number;
  y1: number;
  lines: number[];
  bands: { y0: number; y1: number; value: number; label: string | null }[];
  doors: number;
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

  /** Um trecho (ou a coluna inteira): divide a altura `h`, a partir de `y0`, conforme o tipo. */
  const layPart = (c: DrawingPart, y0: number, h: number, where: string): LaidPart => {
    const count = Math.max(0, Math.floor(c.count || 0));
    // em "Outros" o nome é o que a pessoa escreveu
    const label = c.label?.trim().toUpperCase() || DEFAULT_LABEL[c.kind];
    const inside = c.kind === "PORTAS" ? Math.max(0, Math.floor(c.shelves || 0)) : 0;
    const part: LaidPart = { kind: c.kind, y0, y1: y0 + h, lines: [], bands: [], doors: c.kind === "PORTAS" ? Math.max(1, count) : 0, hidden: c.kind === "PORTAS" };
    const parts = SHELF_LIKE.includes(c.kind) ? count + 1 : c.kind === "GAVETAS" ? count : inside ? inside + 1 : 0;
    if (parts < 1) return part;

    // Entre dois vãos há uma prateleira, que ocupa a espessura da chapa. Gaveta não tem chapa entre as frentes.
    const boards = c.kind === "GAVETAS" ? 0 : parts - 1;
    const avail = h - boards * t;
    if (avail <= 0) throw new DrawingError(`${where}: ${boards} prateleiras de ${mm(t)} mm não cabem em ${mm(h)} mm`);

    // alturas dos vãos livres, de cima para baixo; faltando a última, ela fica com o resto
    let hs = c.heights.filter((v) => v > 0).slice(0, parts);
    if (hs.length === parts - 1) {
      const rest = avail - hs.reduce((s, v) => s + v, 0);
      if (rest <= 0) throw new DrawingError(`${where}: as alturas informadas já passam do que cabe (${mm(avail)} mm${boards ? `, descontadas as prateleiras` : ""})`);
      hs = [...hs, r1(rest)];
    } else if (hs.length !== parts) {
      if (hs.length) warnings.push(`${where}: eram esperadas ${parts} alturas e vieram ${hs.length}; dividi por igual.`);
      hs = Array.from({ length: parts }, () => r1(avail / parts));
    }
    let sum = hs.reduce((s, v) => s + v, 0);
    const fits = boards ? ` (${mm(h)} mm menos ${boards} ${boards > 1 ? "prateleiras" : "prateleira"} de ${mm(t)} mm)` : "";
    if (sum < avail - 1) {
      // Sobrou altura: os vãos ficam como foram digitados e o de baixo recebe a sobra.
      // Esticar todos por igual desenhava prateleira em altura que ninguém pediu.
      const last = r1(hs[hs.length - 1] + (avail - sum));
      warnings.push(`${where}: as alturas somam ${mm(sum)} mm e cabem ${mm(avail)} mm${fits}. Mantive as alturas digitadas e o vão de baixo ficou com ${mm(last)} mm.`);
      hs = [...hs.slice(0, -1), last];
      sum = hs.reduce((s, v) => s + v, 0);
    } else if (sum > avail + 1) {
      warnings.push(`${where}: as alturas somam ${mm(sum)} mm e só cabem ${mm(avail)} mm${fits} — passam ${mm(sum - avail)} mm. O desenho foi encolhido para caber; confira as medidas.`);
    }

    // de baixo para cima, proporcional ao que cabe (a cota impressa é a digitada)
    const k = avail / sum;
    let y = y0;
    const up = [...hs].reverse();
    up.forEach((v, j) => {
      const y1 = y + v * k;
      part.bands.push({ y0: y, y1, value: v, label: c.kind === "PORTAS" ? "PRATELEIRA" : label });
      y = y1;
      if (j < up.length - 1) {
        // a chapa da prateleira (centro em `lines`); entre gavetas é só a linha da frente
        part.lines.push(y + (boards ? t / 2 : 0));
        if (boards) y += t;
      }
    });
    return part;
  };

  let x = sideLeft;
  const columns: LaidColumn[] = spec.columns.map((c, i) => {
    const w = c.width && c.width > 0 ? c.width : share;
    const x0 = x;
    x += w;
    // de cima para baixo, como a pessoa digitou; a coluna simples é um trecho só
    const specs: DrawingPart[] = c.parts?.length ? c.parts : [c];
    const availH = inner - (specs.length - 1) * t;
    if (availH <= 0) throw new DrawingError(`Coluna ${i + 1}: os trechos não cabem na altura do móvel`);
    const givenH = specs.reduce((s, p) => s + (p.height && p.height > 0 ? p.height : 0), 0);
    const freeH = specs.filter((p) => !(p.height && p.height > 0)).length;
    if (givenH > availH + 1) throw new DrawingError(`Coluna ${i + 1}: as alturas dos trechos somam ${mm(givenH)} mm e cabem ${mm(availH)} mm${specs.length > 1 ? ` (descontadas as ${specs.length - 1} chapas entre eles)` : ""}`);
    let scale = 1;
    if (!freeH && Math.abs(givenH - availH) > 1) {
      warnings.push(`Coluna ${i + 1}: as alturas dos trechos somam ${mm(givenH)} mm e cabem ${mm(availH)} mm. O desenho foi ajustado; deixe um trecho sem altura para ele ficar com o resto.`);
      scale = availH / givenH;
    }
    const shareH = freeH ? (availH - givenH) / freeH : 0;

    const parts: LaidPart[] = [];
    const separators: number[] = [];
    let y = base;
    [...specs].reverse().forEach((p, j, all) => {
      const h = p.height && p.height > 0 ? p.height * scale : shareH;
      const n = specs.length - j;
      parts.push(layPart(p, y, h, specs.length > 1 ? `Coluna ${i + 1}, trecho ${n}` : `Coluna ${i + 1}`));
      y += h;
      if (j < all.length - 1) {
        separators.push(y + t / 2);
        y += t;
      }
    });

    // trecho sem divisão (vão, maleiro inteiro, portas) entra na cota pela altura dele
    const bands = parts.flatMap((p) => (p.bands.length ? p.bands : specs.length > 1 ? [{ y0: p.y0, y1: p.y1, value: r1(p.y1 - p.y0), label: null }] : []));
    return {
      kind: specs[0].kind,
      x: x0,
      width: w,
      lines: [...parts.flatMap((p) => p.lines), ...separators].sort((a, b) => a - b),
      bands,
      doors: Math.max(...parts.map((p) => p.doors)),
      hidden: parts.every((p) => p.hidden),
      parts,
      separators,
    };
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
