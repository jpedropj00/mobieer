/**
 * Prancha completa do projeto executivo, desenhada a partir das medidas:
 * perspectiva fechada e aberta, quadro de especificações, vista frontal,
 * frontal interna, lateral, superior, planta interna, detalhe do rodapé e a
 * peça da prateleira. Tudo em vetor; nada aqui é foto.
 *
 * Sai como um PDF de uma página, sem carimbo — a pasta técnica põe o carimbo.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type Color, type PDFFont } from "pdf-lib";
import { layoutDrawing, mm, type DrawingLayout, type DrawingSpec, type LaidColumn } from "./tech-drawing.rules";

const PW = 802;
const PH = 453;
const INK = rgb(0.15, 0.15, 0.15);
const DIM = rgb(0.3, 0.3, 0.3);
const EDGE = rgb(0.32, 0.24, 0.17);
const WHITE = rgb(0.985, 0.985, 0.98);
const SHADE = rgb(0.9, 0.9, 0.89);
const ORANGE = rgb(0.96, 0.62, 0.3);

type Tone = { front: Color; side: Color; top: Color; edge: Color };
const TONES: Record<string, Tone> = {
  MADEIRA: { front: rgb(0.74, 0.56, 0.39), side: rgb(0.62, 0.45, 0.3), top: rgb(0.8, 0.63, 0.45), edge: EDGE },
  BRANCO: { front: rgb(0.95, 0.95, 0.94), side: rgb(0.84, 0.84, 0.83), top: rgb(0.98, 0.98, 0.97), edge: rgb(0.45, 0.45, 0.45) },
  CINZA: { front: rgb(0.7, 0.7, 0.71), side: rgb(0.56, 0.56, 0.57), top: rgb(0.78, 0.78, 0.79), edge: rgb(0.3, 0.3, 0.3) },
  PRETO: { front: rgb(0.27, 0.27, 0.28), side: rgb(0.17, 0.17, 0.18), top: rgb(0.36, 0.36, 0.37), edge: rgb(0.08, 0.08, 0.08) },
};

function safe(font: PDFFont, text: string) {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Linhas do quadro de especificações: o que as medidas já dizem + o que a pessoa escreveu. */
export function boardSpecs(spec: DrawingSpec, L: DrawingLayout): string[] {
  const t = spec.thickness && spec.thickness > 0 ? spec.thickness : 15;
  const doors = L.columns.reduce((s, c) => s + c.doors, 0);
  const shelves = L.columns.reduce((s, c) => s + (c.kind !== "GAVETAS" ? c.lines.length : 0), 0);
  const drawers = L.columns.reduce((s, c) => s + (c.kind === "GAVETAS" ? c.bands.length : 0), 0);
  const n = (v: number) => String(v).padStart(2, "0");
  return [
    `Medidas: L ${mm(L.width)} x A ${mm(L.height)}${spec.depth ? ` x P ${mm(spec.depth)}` : ""} mm`,
    `Chapas de ${mm(t)} mm`,
    ...(doors ? [`${n(doors)} ${doors > 1 ? "portas" : "porta"} de abrir`] : []),
    ...(shelves ? [`${n(shelves)} ${shelves > 1 ? "prateleiras internas" : "prateleira interna"}`] : []),
    ...(drawers ? [`${n(drawers)} ${drawers > 1 ? "gavetas" : "gaveta"}`] : []),
    ...(L.base > 0 ? [`Rodapé de ${mm(L.base)} mm`] : []),
    ...(spec.specs ?? []).map((s) => s.trim()).filter(Boolean),
  ].slice(0, 12);
}

export async function boardPdf(spec: DrawingSpec): Promise<{ pdf: Buffer; warnings: string[] }> {
  const L = layoutDrawing(spec);
  const depth = spec.depth && spec.depth > 0 ? spec.depth : Math.round(L.width / 2);
  const t = spec.thickness && spec.thickness > 0 ? spec.thickness : 15;
  const tone = TONES[spec.finish ?? "MADEIRA"] ?? TONES.MADEIRA;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([PW, PH]);

  // ---------------------------------------------------------------- primitivas
  const line = (xa: number, ya: number, xb: number, yb: number, thickness = 0.4, color: Color = INK) => p.drawLine({ start: { x: xa, y: ya }, end: { x: xb, y: yb }, thickness, color });
  const rect = (x: number, y: number, w: number, h: number, color?: Color, border: Color | null = tone.edge, bw = 0.5) =>
    p.drawRectangle({ x, y, width: w, height: h, color, ...(border ? { borderColor: border, borderWidth: bw } : {}) });
  const poly = (pts: [number, number][], color: Color, border: Color = tone.edge) =>
    p.drawSvgPath(`M ${pts.map(([x, y]) => `${x.toFixed(2)},${(-y).toFixed(2)}`).join(" L ")} Z`, { x: 0, y: 0, color, borderColor: border, borderWidth: 0.5 });
  const text = (s: string, x: number, y: number, size: number, f = font, color: Color = INK) => p.drawText(safe(f, s), { x, y, size, font: f, color });
  const center = (s: string, cx: number, y: number, size: number, f = font, color: Color = INK) => text(s, cx - f.widthOfTextAtSize(safe(f, s), size) / 2, y, size, f, color);
  /** cota horizontal acima (off > 0) ou abaixo (off < 0) do trecho */
  const dimH = (x1: number, x2: number, y: number, label: string, off: number) => {
    const yy = y + off;
    line(x1, yy, x2, yy, 0.35, DIM);
    for (const x of [x1, x2]) {
      line(x, y + Math.sign(off) * 2, x, yy + Math.sign(off) * 3, 0.25, DIM);
      line(x - 2, yy - 2, x + 2, yy + 2, 0.5, DIM);
    }
    center(label, (x1 + x2) / 2, yy + 2, 6.5, font, DIM);
  };
  /** cota vertical à esquerda (off < 0) ou à direita (off > 0) */
  const dimV = (x: number, y1: number, y2: number, label: string, off: number) => {
    const xx = x + off;
    line(xx, y1, xx, y2, 0.35, DIM);
    for (const y of [y1, y2]) {
      line(x + Math.sign(off) * 2, y, xx + Math.sign(off) * 3, y, 0.25, DIM);
      line(xx - 2, y - 2, xx + 2, y + 2, 0.5, DIM);
    }
    const w = font.widthOfTextAtSize(label, 6.5);
    if (Math.abs(y2 - y1) >= w + 2) p.drawText(label, { x: xx - 2, y: (y1 + y2) / 2 - w / 2, size: 6.5, font, color: DIM, rotate: degrees(90) });
    else text(label, off < 0 ? xx - w - 3 : xx + 3, (y1 + y2) / 2 - 2.2, 6, font, DIM);
  };
  const caption = (s: string, cx: number, y: number) => center(s, cx, y, 7.5, bold);

  const innerTop = L.height - L.top;
  const colBody = (c: LaidColumn) => ({ x: c.x + t, w: c.width - 2 * t, y: L.base + t, h: innerTop - L.base - 2 * t });

  // ---------------------------------------------------------------- vistas (origem embaixo à esquerda, escala k)
  /** frente do móvel: fechado (portas) ou aberto (por dentro) */
  const front = (ox: number, oy: number, k: number, open: boolean) => {
    const X = (v: number) => ox + v * k;
    const Y = (v: number) => oy + v * k;
    if (L.base > 0) rect(X(t), Y(0), (L.width - 2 * t) * k, L.base * k, tone.side);
    rect(X(0), Y(L.base), L.width * k, (L.height - L.base) * k, tone.front);
    if (L.top > 0) line(X(0), Y(innerTop), X(L.width), Y(innerTop), 0.5, tone.edge);
    for (const c of L.columns) {
      const b = colBody(c);
      const showInside = open || c.kind === "PRATELEIRAS" || c.kind === "VAO";
      if (c.kind === "GAVETAS") {
        for (const y of c.lines) line(X(c.x), Y(y), X(c.x + c.width), Y(y), 0.6, tone.edge);
      } else if (showInside) {
        rect(X(b.x), Y(b.y), b.w * k, b.h * k, WHITE, tone.edge, 0.4);
        // fundo levemente sombreado em cima, para dar a ideia de profundidade
        rect(X(b.x), Y(b.y + b.h * 0.86), b.w * k, b.h * 0.14 * k, SHADE, null);
        for (const y of c.lines) rect(X(b.x), Y(y - t / 2), b.w * k, Math.max(t * k, 1.2), WHITE, rgb(0.5, 0.5, 0.5), 0.4);
      } else {
        for (let d = 1; d < c.doors; d++) line(X(c.x + (c.width * d) / c.doors), Y(L.base), X(c.x + (c.width * d) / c.doors), Y(innerTop), 0.7, tone.edge);
      }
      if (c.x > 0) line(X(c.x), Y(L.base), X(c.x), Y(innerTop), 0.6, tone.edge);
    }
    rect(X(0), Y(L.base), L.width * k, (L.height - L.base) * k, undefined, tone.edge, 0.7);
  };

  /** perspectiva (cavaleira): a frente sem distorcer e a profundidade a 30° */
  const perspective = (box: { x: number; y: number; w: number; h: number }, open: boolean) => {
    const dx = 0.42 * depth;
    const dy = 0.24 * depth;
    const maxDoor = open ? Math.max(0, ...L.columns.map((c) => (c.doors ? c.width / c.doors : 0))) : 0;
    const swing = { x: 0.34 * maxDoor, y: 0.22 * maxDoor };
    const k = Math.min(box.w / (L.width + dx + 2 * swing.x), box.h / (L.height + dy + swing.y));
    const ox = box.x + (box.w - (L.width + dx) * k) / 2;
    const oy = box.y + swing.y * k + (box.h - (L.height + dy + swing.y) * k) / 2;
    const X = (v: number) => ox + v * k;
    const Y = (v: number) => oy + v * k;
    // lateral e tampo
    poly([[X(L.width), Y(L.base)], [X(L.width) + dx * k, Y(L.base) + dy * k], [X(L.width) + dx * k, Y(L.height) + dy * k], [X(L.width), Y(L.height)]], tone.side);
    poly([[X(0), Y(L.height)], [X(L.width), Y(L.height)], [X(L.width) + dx * k, Y(L.height) + dy * k], [X(0) + dx * k, Y(L.height) + dy * k]], tone.top);
    front(ox, oy, k, open);
    if (!open) return;
    // portas abertas: as da metade esquerda abrem para a esquerda, as outras para a direita
    for (const c of L.columns) {
      if (!c.doors) continue;
      const dw = c.width / c.doors;
      for (let d = 0; d < c.doors; d++) {
        const left = d < c.doors / 2;
        const hx = left ? c.x + d * dw : c.x + (d + 1) * dw;
        const ex = (left ? -0.34 : 0.34) * dw;
        const ey = -0.22 * dw;
        poly([[X(hx), Y(L.base)], [X(hx), Y(innerTop)], [X(hx + ex), Y(innerTop + ey)], [X(hx + ex), Y(L.base + ey)]], left ? tone.front : tone.side);
      }
    }
  };

  // ---------------------------------------------------------------- grade da prancha
  const m = 10;
  const rowTop = { y: 290, h: PH - 290 - m };
  const rowMid = { y: 142, h: 122 };
  const rowBot = { y: m + 12, h: 84 };

  // linha de cima: perspectivas e especificações
  const pw = 250;
  perspective({ x: m, y: rowTop.y + 14, w: pw, h: rowTop.h - 14 }, false);
  caption("PERSPECTIVA FECHADO", m + pw / 2, rowTop.y);
  perspective({ x: m + pw + 14, y: rowTop.y + 14, w: pw, h: rowTop.h - 14 }, true);
  caption("PERSPECTIVA ABERTO", m + pw + 14 + pw / 2, rowTop.y);

  const sx = m + 2 * pw + 34;
  const sw = PW - m - sx;
  const lines = boardSpecs(spec, L);
  const sh = Math.min(rowTop.h - 6, 30 + lines.length * 12);
  const sy = rowTop.y + rowTop.h - sh;
  p.drawRectangle({ x: sx, y: sy, width: sw, height: sh, borderColor: ORANGE, borderWidth: 0.7 });
  text("ESPECIFICAÇÕES", sx + 10, sy + sh - 17, 9, bold);
  lines.forEach((l, i) => {
    let s = safe(font, l);
    while (s.length > 4 && font.widthOfTextAtSize(s, 7.2) > sw - 26) s = s.slice(0, -1);
    text("-", sx + 10, sy + sh - 32 - i * 12, 7.2);
    text(s, sx + 18, sy + sh - 32 - i * 12, 7.2);
  });

  // linha do meio: frontal, frontal interna, lateral, superior
  const cellW = (PW - 2 * m) / 4;
  const cell = (i: number) => ({ x: m + i * cellW, y: rowMid.y, w: cellW, h: rowMid.h });
  const fit = (c: { w: number; h: number }, w: number, h: number, padX: number, padY: number) => Math.min((c.w - padX) / w, (c.h - padY) / h);

  {
    const c = cell(0);
    const k = fit(c, L.width, L.height, 46, 30);
    const ox = c.x + 30 + (c.w - 46 - L.width * k) / 2;
    const oy = c.y + 6;
    front(ox, oy, k, false);
    dimH(ox, ox + L.width * k, oy + L.height * k, mm(L.width), 9);
    dimV(ox, oy + L.base * k, oy + L.height * k, mm(L.height - L.base), -11);
    if (L.base > 0) dimV(ox, oy, oy + L.base * k, mm(L.base), -11);
    caption("VISTA FRONTAL", c.x + c.w / 2, c.y - 12);
  }
  {
    const c = cell(1);
    const k = fit(c, L.width, L.height, 78, 34);
    const ox = c.x + 62 + (c.w - 78 - L.width * k) / 2;
    const oy = c.y + 16;
    front(ox, oy, k, true);
    for (const s of L.chain) dimV(ox, oy + s.y0 * k, oy + s.y1 * k, mm(s.value), -9);
    dimV(ox, oy, oy + L.height * k, mm(L.height), -44);
    dimH(ox, ox + L.width * k, oy, mm(L.width), -10);
    const first = L.columns.find((x) => x.kind !== "GAVETAS") ?? L.columns[0];
    center(mm(first.width - 2 * t), ox + (first.x + first.width / 2) * k, oy + (L.base + t) * k + 4, 6.5, font, DIM);
    caption("VISTA FRONTAL INTERNA", c.x + c.w / 2, c.y - 12);
  }
  {
    const c = cell(2);
    const k = fit(c, depth, L.height, 60, 30);
    const ox = c.x + 34 + (c.w - 60 - depth * k) / 2;
    const oy = c.y + 6;
    const inset = Math.min(50, depth * 0.12);
    if (L.base > 0) rect(ox, oy, (depth - inset) * k, L.base * k, tone.side);
    rect(ox, oy + L.base * k, depth * k, (L.height - L.base) * k, tone.front);
    dimH(ox, ox + depth * k, oy + L.height * k, mm(depth), 9);
    dimV(ox, oy + L.base * k, oy + L.height * k, mm(L.height - L.base), -11);
    if (L.base > 0) dimV(ox, oy, oy + L.base * k, mm(L.base), -11);
    caption("VISTA LATERAL", c.x + c.w / 2, c.y - 12);
  }
  {
    const c = cell(3);
    const k = fit(c, L.width, depth, 46, 40);
    const ox = c.x + 30 + (c.w - 46 - L.width * k) / 2;
    const oy = c.y + (c.h - depth * k) / 2;
    rect(ox, oy, L.width * k, depth * k, tone.top);
    dimH(ox, ox + L.width * k, oy + depth * k, mm(L.width), 9);
    dimV(ox, oy, oy + depth * k, mm(depth), -11);
    caption("VISTA SUPERIOR", c.x + c.w / 2, oy - 14);
  }

  // linha de baixo: planta interna, detalhe do rodapé, prateleira
  {
    const c = { x: m, y: rowBot.y, w: cellW * 1.3, h: rowBot.h };
    const k = fit(c, L.width, depth, 56, 34);
    const ox = c.x + 34 + (c.w - 56 - L.width * k) / 2;
    const oy = c.y + 14;
    rect(ox, oy, L.width * k, depth * k, tone.front);
    // por dentro: o fundo em cima e as divisões entre colunas
    rect(ox + t * k, oy, (L.width - 2 * t) * k, (depth - t) * k, SHADE, tone.edge, 0.4);
    for (const col of L.columns) if (col.x > 0) rect(ox + (col.x - t / 2) * k, oy, Math.max(t * k, 1), (depth - t) * k, tone.front, tone.edge, 0.3);
    dimH(ox, ox + L.width * k, oy + depth * k, mm(L.width), 9);
    dimV(ox, oy, oy + depth * k, mm(depth), -11);
    center(mm(L.width - 2 * t), ox + (L.columns[0].x + L.columns[0].width / 2) * k, oy + (depth * k) / 2 - 2, 6.5, font, DIM);
    text(mm(t), ox + t * k + 2, oy + 3, 5.5, font, DIM);
    caption("PLANTA BAIXA (INTERNA)", c.x + c.w / 2, c.y - 8);
  }
  if (L.base > 0) {
    // recorte da lateral junto ao chão, com a altura do rodapé
    const cx = m + cellW * 1.3 + cellW * 0.65;
    const cy = rowBot.y + rowBot.h / 2 + 8;
    const r = 36;
    p.drawCircle({ x: cx, y: cy, size: r, color: WHITE, borderColor: ORANGE, borderWidth: 0.8 });
    const bx = cx - 22;
    const by = cy - 20;
    rect(bx, by + 20, 44, 26, tone.front);
    rect(bx, by, 30, 20, tone.side);
    dimV(bx + 30, by, by + 20, mm(L.base), 8);
    caption("DETALHE RODAPÉ", cx, rowBot.y - 8);
  }
  const shelfCol = L.columns.find((c) => c.kind !== "GAVETAS" && c.lines.length);
  if (shelfCol) {
    // a peça da prateleira, deitada
    const w = shelfCol.width - 2 * t;
    const cx0 = m + cellW * 2.7;
    const k = Math.min((PW - m - cx0 - 60) / (w + 0.5 * depth), 0.16);
    const ox = cx0 + 16;
    const oy = rowBot.y + 30;
    const dx = 0.5 * depth * k;
    const dy = 0.28 * depth * k;
    const th = Math.max(t * k, 2.4);
    poly([[ox, oy + th], [ox + w * k, oy + th], [ox + w * k + dx, oy + th + dy], [ox + dx, oy + th + dy]], WHITE, rgb(0.45, 0.45, 0.45));
    poly([[ox, oy], [ox + w * k, oy], [ox + w * k, oy + th], [ox, oy + th]], SHADE, rgb(0.45, 0.45, 0.45));
    poly([[ox + w * k, oy], [ox + w * k + dx, oy + dy], [ox + w * k + dx, oy + th + dy], [ox + w * k, oy + th]], rgb(0.82, 0.82, 0.81), rgb(0.45, 0.45, 0.45));
    dimH(ox, ox + w * k, oy, mm(w), -9);
    text(mm(t), ox + w * k + dx + 5, oy + dy + th / 2 - 2, 6.5, font, DIM);
    if (spec.shelfDepth && spec.shelfDepth > 0) text(mm(spec.shelfDepth), ox + w * k + dx / 2 + 6, oy + dy / 2 - 6, 6.5, font, DIM);
    caption("PRATELEIRA INTERNA", ox + (w * k + dx) / 2, rowBot.y - 8);
  }

  return { pdf: Buffer.from(await doc.save()), warnings: L.warnings };
}
