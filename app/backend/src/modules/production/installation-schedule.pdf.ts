/**
 * PDF do cronograma de montagem no modelo da planilha da loja (A4 deitado):
 * cabeçalho com logotipo e dados do cliente, tabela das semanas com o que é
 * instalado em cada etapa e a vistoria final, avisos em destaque, legenda,
 * observações e as observações adicionais.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { durationText, type InstallationScheduleData, type ScheduleWeek } from "./installation-schedule.rules";

const ORANGE = "#C0392B";
const GRAY = "#BFBFBF";
const LIGHT = "#E7E6E6";
const YELLOW = "#FFF2CC";

const br = (iso: string) => iso.split("-").reverse().join("/");

function logoPath() {
  const candidates = [path.join(process.cwd(), "assets", "cronograma", "logo.png"), path.join(__dirname, "..", "..", "..", "assets", "cronograma", "logo.png"), path.join(__dirname, "..", "..", "..", "..", "assets", "cronograma", "logo.png")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function installationSchedulePdf(d: InstallationScheduleData & { client: string; weeks: ScheduleWeek[]; inspection: string; weekends: number }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 30, bottom: 20, left: 30, right: 30 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const W = doc.page.width;
  const L = 30;
  const R = W - 30;

  const box = (x: number, y: number, w: number, h: number, fill?: string) => {
    if (fill) doc.rect(x, y, w, h).fill(fill);
    doc.lineWidth(0.6).strokeColor("#000").rect(x, y, w, h).stroke();
    doc.fillColor("#000");
  };
  /** texto centralizado (ou à esquerda) dentro da caixa, quebrando linha se precisar */
  const cell = (s: string, x: number, y: number, w: number, h: number, o: { size?: number; bold?: boolean; color?: string; align?: "center" | "left" } = {}) => {
    const size = o.size ?? 6.5;
    doc.font(o.bold === false ? "Helvetica" : "Helvetica-Bold").fontSize(size).fillColor(o.color ?? "#000");
    const th = doc.heightOfString(s, { width: w - 8, align: o.align ?? "center" });
    doc.text(s, x + 4, y + Math.max(2, (h - th) / 2), { width: w - 8, align: o.align ?? "center", height: h - 2, ellipsis: true });
    doc.fillColor("#000");
  };

  // ---------------------------------------------------------------- cabeçalho
  const hy = 30;
  const hh = 66;
  box(L, hy, R - L, hh, LIGHT);
  const logo = logoPath();
  if (logo) doc.image(logo, L + 8, hy + 10, { fit: [190, 46] });
  const cx = R - 330;
  box(cx, hy, 150, hh, LIGHT);
  cell("MOBIEER MÓVEIS PLANEJADOS", cx, hy + 2, 150, 14, { size: 6, bold: false, align: "left" });
  cell(d.address ? `ENDEREÇO: ${d.address.toUpperCase()}` : "", cx, hy + 22, 150, 40, { size: 6, bold: false });
  const rx = R - 180;
  const rows = [`CLIENTE: ${d.client.toUpperCase()}`, `AMBIENTES: ${d.ambientes.toUpperCase()}`, `DURAÇÃO: ${durationText(d.weeks.length)}`, `INÍCIO: ${br(d.start)}`, `FINAL: ${br(d.end)}`];
  rows.forEach((t, i) => {
    const rh = i === 0 ? 18 : 12;
    const ry = hy + (i === 0 ? 0 : 18 + (i - 1) * 12);
    box(rx, ry, 180, rh, "#FFFFFF");
    cell(t, rx, ry, 180, rh, { size: i === 0 ? 7 : 6 });
  });

  // ---------------------------------------------------------------- tabela das semanas
  let y = hy + hh + 22;
  const first = 150;
  const n = Math.max(1, d.weeks.length);
  const colW = (R - L - first) / (n + 1);
  const xs = Array.from({ length: n + 2 }, (_, i) => (i === 0 ? L : L + first + (i - 1) * colW));
  box(L, y, R - L, 16);
  cell("TEMPO DE MONTAGEM", L, y, first, 16, { size: 8, align: "left" });
  d.weeks.forEach((w, i) => {
    doc.moveTo(xs[i + 1], y).lineTo(xs[i + 1], y + 16).stroke();
    cell(w.label, xs[i + 1], y, colW, 16, { size: 5.6, color: ORANGE });
  });
  doc.moveTo(xs[n + 1], y).lineTo(xs[n + 1], y + 16).stroke();
  cell("VISTORIA FINAL", xs[n + 1], y, colW, 16, { size: 6.5, color: ORANGE });
  y += 16 + 6;

  // corpo: ETAPA n e os itens de cada semana; a altura acompanha a etapa com mais itens
  // altura de cada item pelo texto (nada é cortado); a etapa mais cheia define a altura da linha
  doc.font("Helvetica-Bold").fontSize(5.8);
  const needs = d.weeks.map((_, i) => (d.stages[i] ?? []).filter(Boolean).map((it) => Math.max(18, doc.heightOfString(it.toUpperCase(), { width: colW - 8 }) + 8)));
  const bodyH = 12 + Math.max(18, ...needs.map((ns) => ns.reduce((a, b) => a + b, 0)));
  box(L, y, R - L, bodyH);
  cell("AMBIENTES", L, y, first, bodyH, { size: 9, align: "left" });
  d.weeks.forEach((_, i) => {
    const x = xs[i + 1];
    doc.moveTo(x, y).lineTo(x, y + bodyH).stroke();
    doc.moveTo(x, y + 12).lineTo(x + colW, y + 12).stroke();
    cell(`ETAPA ${i + 1}`, x, y, colW, 12, { size: 6 });
    const items = (d.stages[i] ?? []).filter(Boolean);
    const total = needs[i].reduce((a, b) => a + b, 0) || 1;
    let iy = y + 12;
    items.forEach((it, k) => {
      const h = (needs[i][k] * (bodyH - 12)) / total;
      if (k > 0) doc.moveTo(x, iy).lineTo(x + colW, iy).stroke();
      cell(it.toUpperCase(), x, iy, colW, h, { size: 5.8 });
      iy += h;
    });
  });
  doc.moveTo(xs[n + 1], y).lineTo(xs[n + 1], y + bodyH).stroke();
  cell(br(d.inspection), xs[n + 1], y, colW, bodyH, { size: 6.5 });
  y += bodyH + 18;

  // ---------------------------------------------------------------- avisos em destaque
  for (const h of d.highlights.filter(Boolean)) {
    box(L, y, R - L, 18);
    cell(h.toUpperCase(), L, y, R - L, 18, { size: 7, color: ORANGE });
    y += 18 + 12;
  }

  // ---------------------------------------------------------------- legenda e OBS
  const legW = 330;
  const ly = y + 4;
  box(L, ly, legW, 26, GRAY);
  cell("LEGENDA:", L, ly, legW, 26, { size: 6 });
  const worked = d.weeks.reduce((s, w) => s + w.businessDays, 0);
  [["DIAS TRABALHADOS", `${worked} DIAS TRABALHADOS`], ["FINAIS DE SEMANA", `${d.weekends} ${d.weekends === 1 ? "FINAL" : "FINAIS"} DE SEMANA`]].forEach(([a, b], i) => {
    box(L, ly + 26 + i * 10, 110, 10, LIGHT);
    box(L + 110, ly + 26 + i * 10, legW - 110, 10, LIGHT);
    cell(a, L, ly + 26 + i * 10, 110, 10, { size: 5.5, bold: false, align: "left" });
    cell(b, L + 110, ly + 26 + i * 10, legW - 110, 10, { size: 5.5, bold: false });
  });
  const ox = L + legW + 160;
  d.obs.filter(Boolean).forEach((o, i) => {
    box(ox, ly + i * 30, R - ox, 24);
    cell(`OBS${i + 1}: ${o.toUpperCase()}`, ox, ly + i * 30, R - ox, 24, { size: 6, align: "left" });
  });
  y = Math.max(ly + 46, ly + d.obs.filter(Boolean).length * 30) + 14;

  // ---------------------------------------------------------------- faixa amarela
  const closing = d.closing.filter(Boolean);
  if (closing.length) {
    const ch = 10 + closing.length * 10;
    box(L, y, R - L, ch, YELLOW);
    closing.forEach((c, i) => cell(c.toUpperCase(), L, y + 4 + i * 10, R - L, 10, { size: 6.2 }));
    y += ch + 14;
  }

  // ---------------------------------------------------------------- observações adicionais
  const extra = d.extra.filter(Boolean);
  if (extra.length) {
    box(L, y, R - L, 11, LIGHT);
    cell("OBSERVAÇÕES ADICIONAIS (QUANDO HOUVER)", L, y, R - L, 11, { size: 6 });
    y += 11;
    extra.forEach((e, i) => {
      box(L, y, 60, 10);
      box(L + 60, y, R - L - 60, 10);
      cell(`obs ${String(i + 1).padStart(2, "0")}:`, L, y, 60, 10, { size: 5.5, bold: false, align: "left" });
      cell(e.toUpperCase(), L + 60, y, R - L - 60, 10, { size: 5.5, bold: false });
      y += 10;
    });
  }

  doc.end();
  return done;
}
