/**
 * Vista frontal cotada, desenhada a partir das medidas (tech-drawing.rules).
 * Sai como um PDF de uma página, sem carimbo: a pasta técnica encaixa a página
 * na prancha e põe o carimbo, o título e a escala.
 */
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import { SHELF_LIKE, layoutDrawing, mm, wrapWords, type DrawingSpec } from "./tech-drawing.rules";

export type BoardImage = { bytes: Buffer; mime: string };
/** imagens 3D que entram ao lado da vista, na mesma folha */
export type BoardImages = { closed?: BoardImage | null; open?: BoardImage | null };

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

export async function drawingPdf(spec: DrawingSpec, images: BoardImages = {}): Promise<{ pdf: Buffer; warnings: string[] }> {
  const L = layoutDrawing(spec);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([PW, PH]);

  // margens: cotas à esquerda, chamada em cima, larguras embaixo
  // com imagem 3D, a vista fica na metade esquerda e a imagem na direita (como na "Vista A" da loja)
  const side = [images.closed, images.open].filter((i): i is BoardImage => Boolean(i));
  const RW = side.length ? PW * 0.56 : PW;
  // chamadas próprias das colunas ficam à direita do móvel
  const notes = spec.columns.map((c, i) => ({ col: L.columns[i], lines: wrapWords((c.note ?? "").trim().toUpperCase(), side.length ? 22 : 30) })).filter((n) => n.lines.length);
  const box = { l: 96, r: notes.length ? (side.length ? 112 : 150) : 40, t: 22 + L.callout.length * 10 + 16, b: 44 };
  const k = Math.min((RW - box.l - box.r) / L.width, (PH - box.t - box.b) / L.height);
  const x0 = box.l + (RW - box.l - box.r - L.width * k) / 2;
  // sobrando altura (vista menor, ao lado da imagem), o desenho fica no meio da folha
  const y0 = box.b + Math.max(0, (PH - box.t - box.b - L.height * k) / 2);
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

  // fechamentos (vistas) laterais: a tira de acabamento de cada lado, na altura toda
  for (const [x, w] of [[0, L.sideLeft], [L.width - L.sideRight, L.sideRight]] as const) {
    if (w > 0) p.drawRectangle({ x: X(x), y: Y(0), width: w * k, height: L.height * k, color: BAND, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.4 });
  }

  const innerH = L.height - L.top - L.base;
  // espessura da chapa: prateleiras e laterais saem com as duas linhas, como no Promob
  const t = L.thickness;
  const EDGE = rgb(0.4, 0.4, 0.4);
  for (const c of L.columns) {
    const cx = X(c.x);
    const cw = c.width * k;
    const shelf = (y: number) => p.drawRectangle({ x: cx + t * k, y: Y(y) - (t * k) / 2, width: cw - 2 * t * k, height: Math.max(t * k, 1.4), color: rgb(0.9, 0.9, 0.9), borderColor: EDGE, borderWidth: 0.4 });
    for (const part of c.parts) {
      const ph = part.y1 - part.y0;
      const mid = (part.y0 + part.y1) / 2;
      if (part.kind === "PORTAS") {
        p.drawRectangle({ x: cx, y: Y(part.y0), width: cw, height: ph * k, color: DOOR });
        for (let d = 1; d < part.doors; d++) line(cx + (cw * d) / part.doors, Y(part.y0), cx + (cw * d) / part.doors, Y(part.y1), 0.6, rgb(0.75, 0.75, 0.75));
        // puxador: um traço curto junto ao encontro das portas (ou na borda, com uma porta só)
        const hx = part.doors > 1 ? cx + cw / part.doors - 3 : cx + cw - 6;
        line(hx, Y(mid) - 5, hx, Y(mid) + 5, 1.4, rgb(0.85, 0.85, 0.85));
      } else if (part.kind === "VAO") {
        p.drawRectangle({ x: cx, y: Y(part.y0), width: cw, height: ph * k, color: EMPTY });
      }
      const open = SHELF_LIKE.includes(part.kind) || part.kind === "VAO";
      // laterais, teto e base da caixaria com a espessura da chapa (na coluna de um trecho só)
      if (open && c.parts.length === 1 && c.width > 4 * t && ph > 4 * t) p.drawRectangle({ x: cx + t * k, y: Y(part.y0 + t), width: cw - 2 * t * k, height: (ph - 2 * t) * k, borderColor: EDGE, borderWidth: 0.4 });
      // prateleira atrás de porta não aparece na vista de fora
      for (const y of part.hidden ? [] : part.lines) {
        if (part.kind === "GAVETAS") line(cx, Y(y), cx + cw, Y(y), 0.6, rgb(0.45, 0.45, 0.45));
        // a chapa da prateleira: duas linhas, afastadas pela espessura
        else shelf(y);
      }
      for (const b of part.hidden ? [] : part.bands) {
        const h = (b.y1 - b.y0) * k;
        if (b.label && h >= 10 && cw >= 40) center(b.label, cx + cw / 2, part.kind !== "GAVETAS" && part.bands.length > 1 ? Y(b.y1) - 9 : Y((b.y0 + b.y1) / 2) - 2.5, 6, RED);
      }
    }
    // a chapa que separa um trecho do outro
    for (const y of c.separators) shelf(y);
    if (c.x > L.sideLeft) line(cx, Y(L.base), cx, Y(L.height - L.top), 0.7, rgb(0.4, 0.4, 0.4));
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
  // larguras: fechamento esquerdo, colunas, fechamento direito
  const parts = [...(L.sideLeft > 0 ? [{ x: 0, width: L.sideLeft }] : []), ...L.columns, ...(L.sideRight > 0 ? [{ x: L.width - L.sideRight, width: L.sideRight }] : [])];
  if (parts.length > 1) {
    line(X(0), wy, X(L.width), wy, 0.4, DIM);
    for (const c of parts) {
      for (const v of [c.x, c.x + c.width]) line(X(v), wy - 3, X(v), wy + 3, 0.4, DIM);
      center(mm(c.width), X(c.x + c.width / 2), wy + 3, 6.5, DIM);
    }
  }
  const ty = parts.length > 1 ? wy - 16 : wy;
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

  // chamadas das colunas: ponto dentro da coluna, linha até o texto à direita
  let ny = Y(L.height - L.top) - 30;
  for (const n of notes) {
    const px2 = X(n.col.x + n.col.width * 0.6);
    const tx = X(L.width) + 22;
    n.lines.forEach((l, i) => text(l, tx, ny - i * 9, 6.5));
    const bottom = ny - (n.lines.length - 1) * 9 - 3;
    const w = Math.max(...n.lines.map((l) => font.widthOfTextAtSize(safe(font, l), 6.5)));
    line(tx - 2, bottom, tx + w + 2, bottom, 0.4);
    line(px2, bottom, tx - 2, bottom, 0.4);
    p.drawCircle({ x: px2, y: bottom, size: 1.8, color: INK });
    ny = bottom - 26;
  }

  // imagens 3D na metade direita, uma embaixo da outra
  const slotH = (PH - 16) / Math.max(1, side.length);
  for (const [i, img] of side.entries()) {
    try {
      const emb = /png/i.test(img.mime) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
      const area = { x: RW + 8, y: PH - 8 - (i + 1) * slotH + 4, w: PW - RW - 16, h: slotH - 8 };
      const s = Math.min(area.w / emb.width, area.h / emb.height);
      p.drawImage(emb, { x: area.x + (area.w - emb.width * s) / 2, y: area.y + (area.h - emb.height * s) / 2, width: emb.width * s, height: emb.height * s });
    } catch {
      // imagem que o PDF não consegue ler fica de fora; a vista sai
    }
  }

  return { pdf: Buffer.from(await doc.save()), warnings: L.warnings };
}
