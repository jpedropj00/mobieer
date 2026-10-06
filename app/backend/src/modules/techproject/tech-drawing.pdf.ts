/**
 * Vista frontal cotada, desenhada a partir das medidas (tech-drawing.rules).
 * Sai como um PDF de uma página, sem carimbo: a pasta técnica encaixa a página
 * na prancha e põe o carimbo, o título e a escala.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import { layoutDrawing, mm, type DrawingSpec } from "./tech-drawing.rules";
import { boardPdf } from "./tech-board.pdf";

const PW = 802;
const PH = 453;
const INK = rgb(0.15, 0.15, 0.15);
const DIM = rgb(0.35, 0.35, 0.35);
const RED = rgb(0.85, 0.1, 0.25);
const BODY = rgb(0.8, 0.8, 0.8);
const BAND = rgb(0.7, 0.7, 0.7);
const DOOR = rgb(0.38, 0.38, 0.39);
const EMPTY = rgb(0.93, 0.93, 0.93);

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

export async function drawingPdf(spec: DrawingSpec): Promise<{ pdf: Buffer; warnings: string[] }> {
  if (spec.layout === "PRANCHA") return boardPdf(spec);
  const L = layoutDrawing(spec);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([PW, PH]);

  // margens: cotas à esquerda, chamada em cima, larguras embaixo
  const box = { l: 96, r: 40, t: 22 + L.callout.length * 10 + 16, b: 44 };
  const k = Math.min((PW - box.l - box.r) / L.width, (PH - box.t - box.b) / L.height);
  const x0 = box.l + (PW - box.l - box.r - L.width * k) / 2;
  const y0 = box.b;
  const X = (v: number) => x0 + v * k;
  const Y = (v: number) => y0 + v * k;
  const line = (xa: number, ya: number, xb: number, yb: number, thickness = 0.5, color = INK) => p.drawLine({ start: { x: xa, y: ya }, end: { x: xb, y: yb }, thickness, color });
  const text = (s: string, x: number, y: number, size: number, color = INK) => p.drawText(safe(font, s), { x, y, size, font, color });
  const center = (s: string, cx: number, y: number, size: number, color = INK) => text(s, cx - font.widthOfTextAtSize(safe(font, s), size) / 2, y, size, color);
  /** texto em pé (lido de baixo para cima), centrado em cy */
  const upright = (s: string, x: number, cy: number, size: number, color = DIM) =>
    p.drawText(safe(font, s), { x, y: cy - font.widthOfTextAtSize(safe(font, s), size) / 2, size, font, color, rotate: degrees(90) });

  // corpo, topo e rodapé
  p.drawRectangle({ x: X(0), y: Y(0), width: L.width * k, height: L.height * k, color: BODY });
  if (L.top > 0) p.drawRectangle({ x: X(0), y: Y(L.height - L.top), width: L.width * k, height: L.top * k, color: BAND });
  if (L.base > 0) p.drawRectangle({ x: X(0), y: Y(0), width: L.width * k, height: L.base * k, color: BAND });

  const innerH = L.height - L.top - L.base;
  for (const c of L.columns) {
    const cx = X(c.x);
    const cw = c.width * k;
    if (c.kind === "PORTAS") {
      p.drawRectangle({ x: cx, y: Y(L.base), width: cw, height: innerH * k, color: DOOR });
      for (let d = 1; d < c.doors; d++) line(cx + (cw * d) / c.doors, Y(L.base), cx + (cw * d) / c.doors, Y(L.height - L.top), 0.6, rgb(0.75, 0.75, 0.75));
      // puxador: um traço curto junto ao encontro das portas (ou na borda, com uma porta só)
      const hx = c.doors > 1 ? cx + cw / c.doors - 3 : cx + cw - 6;
      line(hx, Y(L.base + innerH / 2) - 5, hx, Y(L.base + innerH / 2) + 5, 1.4, rgb(0.85, 0.85, 0.85));
    } else if (c.kind === "VAO") {
      p.drawRectangle({ x: cx, y: Y(L.base), width: cw, height: innerH * k, color: EMPTY });
    }
    // prateleira atrás de porta não aparece na vista de fora
    for (const y of c.hidden ? [] : c.lines) line(cx, Y(y), cx + cw, Y(y), c.kind === "GAVETAS" ? 0.6 : 1.1, rgb(0.45, 0.45, 0.45));
    for (const b of c.hidden ? [] : c.bands) {
      const h = (b.y1 - b.y0) * k;
      if (b.label && h >= 10 && cw >= 40) center(b.label, cx + cw / 2, c.kind === "PRATELEIRAS" ? Y(b.y1) - 9 : Y((b.y0 + b.y1) / 2) - 2.5, 6, RED);
    }
    if (c.x > 0) line(cx, Y(L.base), cx, Y(L.height - L.top), 0.7, rgb(0.4, 0.4, 0.4));
  }
  p.drawRectangle({ x: X(0), y: Y(0), width: L.width * k, height: L.height * k, borderColor: INK, borderWidth: 0.8 });

  // cotas verticais: cadeia (rodapé, vãos, topo) e, mais afastada, a altura total
  const chainX = X(0) - 20;
  line(chainX, Y(0), chainX, Y(L.height), 0.4, DIM);
  for (const s of L.chain) {
    for (const y of [s.y0, s.y1]) {
      line(chainX - 3, Y(y), chainX + 3, Y(y), 0.4, DIM);
      line(chainX + 3, Y(y), X(0) - 2, Y(y), 0.2, rgb(0.7, 0.7, 0.7));
    }
    const h = (s.y1 - s.y0) * k;
    const label = mm(s.value);
    // faixa baixa demais para o número em pé: escreve deitado, à esquerda da linha
    if (h >= font.widthOfTextAtSize(label, 6.5) + 2) upright(label, chainX - 3, Y((s.y0 + s.y1) / 2), 6.5);
    else text(label, chainX - 5 - font.widthOfTextAtSize(label, 6), Y((s.y0 + s.y1) / 2) - 2, 6, DIM);
  }
  const totalX = chainX - 30;
  line(totalX, Y(0), totalX, Y(L.height), 0.4, DIM);
  for (const y of [0, L.height]) line(totalX - 3, Y(y), totalX + 3, Y(y), 0.4, DIM);
  upright(mm(L.height), totalX - 3, Y(L.height / 2), 7);

  // cotas horizontais: larguras das colunas e a largura total
  const wy = Y(0) - 14;
  if (L.columns.length > 1) {
    line(X(0), wy, X(L.width), wy, 0.4, DIM);
    for (const c of L.columns) {
      for (const v of [c.x, c.x + c.width]) line(X(v), wy - 3, X(v), wy + 3, 0.4, DIM);
      center(mm(c.width), X(c.x + c.width / 2), wy + 3, 6.5, DIM);
    }
  }
  const ty = L.columns.length > 1 ? wy - 16 : wy;
  line(X(0), ty, X(L.width), ty, 0.4, DIM);
  for (const v of [0, L.width]) line(X(v), ty - 3, X(v), ty + 3, 0.4, DIM);
  center(mm(L.width), X(L.width / 2), ty + 3, 7, DIM);

  // chamada: texto em cima, com a linha até um ponto dentro do móvel
  const first = L.columns[0];
  const px = X(first.x + first.width * 0.4);
  const py = Y(L.height - L.top) - Math.min(18, innerH * k * 0.2);
  const cy = Y(L.height) + 14;
  L.callout.forEach((l, i) => text(l, px - 34, cy + (L.callout.length - 1 - i) * 10 + 3, 7.5));
  const under = Math.max(...L.callout.map((l) => font.widthOfTextAtSize(safe(font, l), 7.5)));
  line(px - 36, cy, px - 34 + under + 2, cy, 0.4);
  line(px, cy, px, py, 0.4);
  p.drawCircle({ x: px, y: py, size: 1.8, color: INK });

  return { pdf: Buffer.from(await doc.save()), warnings: L.warnings };
}
