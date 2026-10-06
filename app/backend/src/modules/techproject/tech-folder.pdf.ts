/**
 * PDF da pasta técnica (A4 deitado) no modelo da loja: desenho ocupando a
 * folha, título e escala, e o carimbo com cliente, ambiente e logotipo.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { fitRect, sheetIndex, sheetsByRoom, type SpecBlock, type TechSheet } from "./tech-folder.rules";

const W = 841.92;
const H = 595.32;
const M = 20;
const COPPER = rgb(0.72, 0.4, 0.3);
const ORANGE = rgb(0.96, 0.62, 0.3);
const GRAY = rgb(0.38, 0.38, 0.38);
const INK = rgb(0.1, 0.1, 0.1);
const RED = rgb(0.85, 0.1, 0.25);
const STAMP = { y: 42, h: 46 };

function logoBytes(): Buffer | null {
  const rel = ["assets", "cronograma", "logo.png"];
  const candidates = [path.join(process.cwd(), ...rel), path.join(__dirname, "..", "..", "..", ...rel), path.join(__dirname, "..", "..", "..", "..", ...rel)];
  const p = candidates.find((c) => fs.existsSync(c));
  return p ? fs.readFileSync(p) : null;
}

/** As fontes padrão do PDF só têm o alfabeto latino: o que não existe vira "?". */
function safe(font: PDFFont, text: string) {
  let out = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of safe(font, text).split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && font.widthOfTextAtSize(next, size) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export type TechFolderPdfInput = {
  client: string;
  project: { code: string; name: string };
  sheets: (TechSheet & { bytes: Buffer })[];
  specs: SpecBlock[];
  notes: string[];
  issuedAt: Date;
};

export async function techFolderPdf(d: TechFolderPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pasta técnica — ${d.project.code}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logoRaw = logoBytes();
  const logo: PDFImage | null = logoRaw ? await doc.embedPng(logoRaw) : null;

  const text = (p: PDFPage, s: string, x: number, y: number, size: number, f = font, color = INK) => p.drawText(safe(f, s), { x, y, size, font: f, color });
  const right = (p: PDFPage, s: string, x: number, y: number, size: number, f = font, color = INK) => text(p, s, x - f.widthOfTextAtSize(safe(f, s), size), y, size, f, color);

  const stamp = (p: PDFPage, room: string, project?: string | null) => {
    p.drawRectangle({ x: M, y: STAMP.y, width: W - 2 * M, height: STAMP.h, borderColor: ORANGE, borderWidth: 0.6 });
    p.drawRectangle({ x: M + 3, y: STAMP.y + 3, width: W - 2 * M - 6, height: STAMP.h - 6, borderColor: ORANGE, borderWidth: 0.4 });
    text(p, `CLIENTE:  ${d.client.toUpperCase()}`, M + 22, STAMP.y + 26, 12, font, GRAY);
    text(p, `AMBIENTE:  ${room.toUpperCase()}`, M + 22, STAMP.y + 11, 12, font, GRAY);
    // prancha completa: o que é o móvel, no meio do carimbo
    if (project) {
      text(p, "PROJETO EXECUTIVO", W / 2 - 20, STAMP.y + 26, 11, font, GRAY);
      text(p, safe(font, project.toUpperCase()).slice(0, 44), W / 2 - 20, STAMP.y + 12, 9, font, GRAY);
    }
    if (logo) {
      const lh = 30;
      const lw = (logo.width / logo.height) * lh;
      p.drawImage(logo, { x: W - M - 22 - lw, y: STAMP.y + (STAMP.h - lh) / 2, width: lw, height: lh });
    } else right(p, "MOBIEER", W - M - 22, STAMP.y + 16, 18, bold, COPPER);
  };

  // ---------------- capa e especificação: montadas antes para o índice saber as folhas
  const specPages: SpecBlock[][] = [];
  for (let i = 0; i < d.specs.length; i += 4) specPages.push(d.specs.slice(i, i + 4));
  const index = sheetIndex(d.sheets, specPages.length);
  const total = 1 + specPages.length + d.sheets.length;
  const ambientes = [...new Set([...d.specs.map((s) => s.room), ...sheetsByRoom(d.sheets).map((g) => g.room)])];

  const cover = doc.addPage([W, H]);
  if (logo) {
    const lh = 54;
    cover.drawImage(logo, { x: M + 30, y: H - 110, width: (logo.width / logo.height) * lh, height: lh });
  }
  right(cover, "PASTA TÉCNICA", W - M - 30, H - 78, 24, bold, COPPER);
  right(cover, "PROJETO EXECUTIVO", W - M - 30, H - 98, 11, font, GRAY);
  cover.drawLine({ start: { x: M + 30, y: H - 130 }, end: { x: W - M - 30, y: H - 130 }, thickness: 0.8, color: ORANGE });
  let y = H - 165;
  for (const [label, value] of [
    ["CLIENTE", d.client],
    ["PROJETO", `${d.project.code} — ${d.project.name}`],
    ["AMBIENTES", ambientes.join(", ") || "—"],
    ["EMISSÃO", d.issuedAt.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })],
  ]) {
    text(cover, label, M + 30, y, 9, bold, COPPER);
    const lines = wrap(font, value, 12, W - 2 * M - 180);
    lines.forEach((l, i) => text(cover, l, M + 130, y - i * 15, 12));
    y -= Math.max(1, lines.length) * 15 + 9;
  }
  y -= 8;
  text(cover, "ÍNDICE DE FOLHAS", M + 30, y, 9, bold, COPPER);
  y -= 18;
  const rows = [...(specPages.length ? [{ n: 2, room: "Todos", title: specPages.length > 1 ? `ESPECIFICAÇÃO (${specPages.length} folhas)` : "ESPECIFICAÇÃO" }] : []), ...index];
  const half = Math.ceil(rows.length / 2);
  const perCol = Math.max(half, 1);
  rows.forEach((r, i) => {
    const col = i < perCol ? 0 : 1;
    const ry = y - (i - col * perCol) * 14;
    if (ry < STAMP.y + STAMP.h + 30) return;
    const x = M + 30 + col * ((W - 2 * M - 60) / 2);
    text(cover, String(r.n).padStart(2, "0"), x, ry, 10, bold);
    text(cover, safe(font, `${r.title} — ${r.room}`).slice(0, 62), x + 26, ry, 10);
  });
  for (const [i, n] of d.notes.filter(Boolean).slice(0, 4).entries()) text(cover, `• ${n}`.slice(0, 150), M + 30, STAMP.y + STAMP.h + 14 + (3 - i) * 12, 9, font, GRAY);
  stamp(cover, ambientes.join(", ").slice(0, 60) || d.project.name);
  right(cover, `FOLHA 01/${String(total).padStart(2, "0")}`, W - M, STAMP.y - 14, 8, font, GRAY);

  specPages.forEach((blocks, pi) => {
    const p = doc.addPage([W, H]);
    text(p, "ESPECIFICAÇÃO DOS AMBIENTES", M + 10, H - 46, 15, bold, COPPER);
    text(p, "Acabamentos conforme o orçamento aprovado. Conferir com as pranchas antes da produção.", M + 10, H - 62, 9, font, GRAY);
    const colW = (W - 2 * M - 30) / 2;
    blocks.forEach((b, i) => {
      const x = M + 10 + (i % 2) * (colW + 10);
      let by = H - 95 - Math.floor(i / 2) * 205;
      p.drawRectangle({ x, y: by - 6, width: colW, height: 20, color: rgb(0.98, 0.94, 0.9) });
      text(p, b.room.toUpperCase().slice(0, 52), x + 8, by, 11, bold);
      by -= 24;
      for (const r of b.rows) {
        text(p, r.label.toUpperCase(), x + 8, by, 7.5, bold, COPPER);
        const lines = wrap(font, r.value, 9.5, colW - 120).slice(0, 2);
        lines.forEach((l, li) => text(p, l, x + 104, by - li * 11, 9.5));
        by -= lines.length * 11 + 6;
      }
      if (b.description) for (const l of wrap(font, b.description, 8.5, colW - 16).slice(0, 5)) {
        text(p, l, x + 8, by, 8.5, font, GRAY);
        by -= 10.5;
      }
    });
    stamp(p, blocks.map((b) => b.room).join(", ").slice(0, 60));
    right(p, "ESPECIFICAÇÃO", W - M - 22, STAMP.y + STAMP.h + 10, 10);
    right(p, `FOLHA ${String(2 + pi).padStart(2, "0")}/${String(total).padStart(2, "0")}`, W - M, STAMP.y - 14, 8, font, GRAY);
  });

  // ---------------- pranchas
  const ordered = sheetsByRoom(d.sheets).flatMap((g) => g.sheets) as (TechSheet & { bytes: Buffer })[];
  const pdfCache = new Map<string, PDFDocument>();
  for (const [i, s] of ordered.entries()) {
    const folha = `FOLHA ${String(index[i].n).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
    const isPdf = s.mime === "application/pdf";
    if (isPdf && !s.stamp) {
      // já veio pronta do Promob (com carimbo): entra como está
      if (!pdfCache.has(s.storageKey)) pdfCache.set(s.storageKey, await PDFDocument.load(s.bytes, { ignoreEncryption: true }));
      const src = pdfCache.get(s.storageKey)!;
      const [copied] = await doc.copyPages(src, [Math.min(s.page ?? 0, src.getPageCount() - 1)]);
      doc.addPage(copied);
      continue;
    }
    const p = doc.addPage([W, H]);
    const area = { x: M, y: STAMP.y + STAMP.h + 34, w: W - 2 * M, h: H - M - (STAMP.y + STAMP.h + 34) };
    if (isPdf) {
      if (!pdfCache.has(s.storageKey)) pdfCache.set(s.storageKey, await PDFDocument.load(s.bytes, { ignoreEncryption: true }));
      const src = pdfCache.get(s.storageKey)!;
      const [emb] = await doc.embedPdf(src, [Math.min(s.page ?? 0, src.getPageCount() - 1)]);
      const r = fitRect(emb.width, emb.height, area);
      p.drawPage(emb, { x: r.x, y: r.y, width: r.w, height: r.h });
    } else {
      const img = /png/i.test(s.mime) ? await doc.embedPng(s.bytes) : await doc.embedJpg(s.bytes);
      const r = fitRect(img.width, img.height, area);
      p.drawImage(img, { x: r.x, y: r.y, width: r.w, height: r.h });
    }
    const baseY = STAMP.y + STAMP.h + 10;
    right(p, s.title.toUpperCase(), W - M - 22, baseY, 10);
    if (s.scale) text(p, s.scale, W / 2 - font.widthOfTextAtSize(s.scale, 8) / 2, baseY, 8);
    if (s.note) right(p, s.note, W - M - 22, baseY + 16, 9, font, RED);
    stamp(p, s.room, s.drawing?.layout === "PRANCHA" ? s.drawing.description || s.title : null);
    right(p, folha, W - M, STAMP.y - 14, 8, font, GRAY);
  }

  return Buffer.from(await doc.save());
}
