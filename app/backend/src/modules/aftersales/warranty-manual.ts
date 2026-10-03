/**
 * "Manual de uso e certificado de garantia" no modelo da loja, preenchido.
 *
 * As páginas fixas (capa, boas-vindas, cuidados, garantia, assistência e
 * contracapa) saem de assets/garantia/manual-base.pdf, sem mexer. A página do
 * certificado e a da declaração são remontadas a partir do arquivo editável da
 * loja (layout.json + imagens, gerados por scripts/build-warranty-template.py)
 * e o sistema só escreve os dados do cliente em cima das linhas.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { FIELD_LABELS, MANUAL_ROOMS, dateParts, labelKey, matchRooms, splitPhone } from "./warranty-manual.rules";

type Img = { t: "img"; f: string; x: number; y: number; w: number; h: number; line?: number; box?: [number, number, number, number] };
type Txt = { t: "txt"; x: number; y: number; w: number; h: number; lines: string[]; color: string; font: string; size: number; leading: number | null; spc: number; align: "left" | "center" };
type Layout = { page: { w: number; h: number }; certificado: (Img | Txt)[]; declaracao: (Img | Txt)[] };

export type WarrantyManualData = {
  client: { name: string; document: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; zipCode: string | null };
  project: { code: string };
  designer: string | null;
  consultant: string | null;
  installers: string | null;
  purchaseDate: Date | null;
  deliveryDate: Date | null;
  inspectionDate: Date | null;
  ambientes: string | null;
  issuedAt: Date;
};

function assetsDir() {
  const candidates = [path.join(process.cwd(), "assets", "garantia"), path.join(__dirname, "..", "..", "..", "assets", "garantia"), path.join(__dirname, "..", "..", "..", "..", "assets", "garantia")];
  const dir = candidates.find((d) => fs.existsSync(path.join(d, "layout.json")));
  if (!dir) throw new Error("Modelo do certificado de garantia não encontrado (assets/garantia)");
  return dir;
}

const hex = (c: string) => rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
const INK = rgb(0.1, 0.1, 0.1);

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

function wrap(font: PDFFont, text: string, size: number, width: number, spc: number) {
  const w = (s: string) => font.widthOfTextAtSize(s, size) + spc * Math.max(0, s.length - 1);
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && w(next) > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function warrantyManualPdf(d: WarrantyManualData): Promise<Buffer> {
  const dir = assetsDir();
  const layout = JSON.parse(fs.readFileSync(path.join(dir, "layout.json"), "utf8")) as Layout;
  const base = await PDFDocument.load(fs.readFileSync(path.join(dir, "manual-base.pdf")));
  const doc = await PDFDocument.create();
  doc.setTitle(`Manual de uso e certificado de garantia — ${d.project.code}`);

  const fonts = {
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    light: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const fontOf = (name: string) => (/fraunces/i.test(name) ? fonts.serif : /light/i.test(name) ? fonts.light : fonts.bold);
  const images = new Map<string, PDFImage>();
  const image = async (f: string) => {
    if (!images.has(f)) images.set(f, await doc.embedPng(fs.readFileSync(path.join(dir, f))));
    return images.get(f)!;
  };
  const H = layout.page.h;

  /** Desenha o modelo em branco; devolve onde ficou a primeira linha de cada texto. */
  const drawTemplate = async (page: PDFPage, items: (Img | Txt)[]) => {
    for (const it of items) {
      if (it.t === "img") {
        page.drawImage(await image(it.f), { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h });
        continue;
      }
      // "/ ____ / ____" solto repete o desenho das linhas de data: não redesenha
      if (it.lines.every((l) => /^[\s/_]*$/.test(l)) && it.lines.join("").includes("/") && items.some((o) => o.t === "img" && Math.abs(o.y + o.h / 2 - (it.y + it.h / 2)) < 16 && o.x < it.x && o.x + o.w > it.x)) continue;
      const font = fontOf(it.font);
      const leading = it.leading ?? it.size * 1.2;
      const single = it.lines.length === 1 && it.h < leading * 1.6;
      let size = it.size;
      const widthOf = (s: string, sz = size) => font.widthOfTextAtSize(s, sz) + it.spc * Math.max(0, s.length - 1);
      const out: string[] = [];
      for (const raw of it.lines) {
        const text = safe(font, raw);
        if (single) {
          // fonte substituta mais larga que a original: encolhe o que passar da página
          const room = it.align === "center" ? it.w * 1.25 : layout.page.w - it.x - 30;
          if (widthOf(text) > room) size = (size * room) / widthOf(text);
          out.push(text);
        } else out.push(...wrap(font, text, size, it.w, it.spc));
      }
      let y = H - it.y - (leading - it.size) / 2 - it.size * 0.8;
      if (it.spc) page.pushOperators(setCharacterSpacing(it.spc));
      for (const line of out) {
        const x = it.align === "center" ? it.x + (it.w - widthOf(line)) / 2 : it.x;
        page.drawText(line, { x, y, size, font, color: hex(it.color) });
        y -= leading;
      }
      if (it.spc) page.pushOperators(setCharacterSpacing(0));
    }
  };

  const write = (page: PDFPage, text: string, x: number, baseline: number, maxWidth: number, opts: { size?: number; center?: boolean } = {}) => {
    const t = safe(fonts.light, text);
    let size = opts.size ?? 13;
    const w = () => fonts.light.widthOfTextAtSize(t, size);
    if (w() > maxWidth) size = Math.max(7, (size * maxWidth) / w());
    page.drawText(t, { x: opts.center ? x - w() / 2 : x, y: H - baseline, size, font: fonts.light, color: INK });
  };

  // ---------------- página do certificado
  const [cover, welcome, care, terms, support, back] = await doc.copyPages(base, [0, 1, 2, 3, 4, 5]);
  for (const p of [cover, welcome, care, terms, support]) doc.addPage(p);

  const cert = doc.addPage([layout.page.w, H]);
  await drawTemplate(cert, layout.certificado);

  const imgs = layout.certificado.filter((i): i is Img => i.t === "img" && i.h < 40 && i.w > 60);
  const phone = splitPhone(d.client.phone);
  const values: Record<string, string | null> = {
    cliente: d.client.name,
    documento: d.client.document,
    email: d.client.email,
    endereco: d.client.address,
    cidade: d.client.city,
    cep: d.client.zipCode,
    contrato: d.project.code,
    consultor: d.consultant,
    projetista: d.designer,
    montadores: d.installers,
  };
  const dates: Record<string, Date | null> = { dataCompra: d.purchaseDate, dataEntrega: d.deliveryDate, dataVistoria: d.inspectionDate };

  for (const label of layout.certificado) {
    if (label.t !== "txt") continue;
    const field = FIELD_LABELS[labelKey(label.lines[0])];
    if (!field) continue;
    // a linha de escrita é a imagem logo à direita do rótulo, na mesma altura
    const mid = label.y + label.h / 2;
    const line = imgs.filter((i) => Math.abs(i.y + i.h / 2 - mid) < 15 && i.x >= label.x + label.w - 8).sort((a, b) => a.x - b.x)[0];
    if (!line) continue;
    const ruleY = line.y + line.h * (line.line ?? 0.5);
    const baseline = ruleY - 4;
    const [bx0, , bx1] = line.box ?? [0.02, 0, 0.98, 1];
    const left = line.x + line.w * bx0;
    const span = line.w * (bx1 - bx0);

    if (field in dates) {
      const parts = dateParts(dates[field]);
      // dia, mês e ano nos três espaços do "__/__/__"
      if (parts) parts.forEach((p, i) => write(cert, p, left + span * [0.17, 0.5, 0.835][i], baseline, span * 0.28, { center: true }));
    } else if (field === "telefone") {
      if (!phone) continue;
      if (phone.ddd) write(cert, phone.ddd, left + span * 0.1, baseline, span * 0.15, { center: true });
      write(cert, phone.number, left + span * 0.27, baseline, span * 0.7);
    } else if (values[field]?.trim()) {
      // nunca encosta no rótulo (no CEP a linha começa colada nele)
      const x = Math.max(left + 4, label.x + label.w + 8);
      write(cert, values[field]!.trim(), x, baseline, left + span - x - 4);
    }
  }

  // ambientes entregues: X na caixinha; o que não está no modelo vai em "Outros"
  const rooms = matchRooms(d.ambientes);
  const boxes = layout.certificado.filter((i): i is Img => i.t === "img" && i.w < 40 && i.h < 40);
  for (const label of layout.certificado) {
    if (label.t !== "txt") continue;
    const text = label.lines[0].trim();
    const mid = label.y + label.h / 2;
    if (/^outros:?$/i.test(text)) {
      if (rooms.others) write(cert, rooms.others, label.x + label.w + 8, label.y + label.h - 4, layout.page.w - label.x - label.w - 60, { size: 12.5 });
      continue;
    }
    const room = MANUAL_ROOMS.find((r) => labelKey(r) === labelKey(text));
    if (!room || !rooms.checked.includes(room)) continue;
    const box = boxes.filter((b) => Math.abs(b.y + b.h / 2 - mid) < 14 && b.x < label.x && label.x - b.x < 60).sort((a, b) => b.x - a.x)[0];
    // quatro ambientes do modelo não têm caixinha: o X vai logo antes do nome
    const [x0, y0, x1, y1] = box?.box ?? [0, 0, 1, 1];
    const cx = box ? box.x + (box.w * (x0 + x1)) / 2 : label.x - 12;
    const cy = box ? box.y + (box.h * (y0 + y1)) / 2 : mid;
    const r = 5;
    for (const s of [1, -1]) cert.drawLine({ start: { x: cx - r, y: H - cy - r * s }, end: { x: cx + r, y: H - cy + r * s }, thickness: 1.6, color: INK });
  }

  // ---------------- página da declaração: só a data
  const decl = doc.addPage([layout.page.w, H]);
  await drawTemplate(decl, layout.declaracao);
  const dateLine = layout.declaracao.find((i): i is Txt => i.t === "txt" && /^[\s/_]+$/.test(i.lines[0]) && i.lines[0].includes("/"));
  const today = dateParts(d.issuedAt);
  if (dateLine && today) {
    const font = fontOf(dateLine.font);
    const raw = dateLine.lines[0];
    const leading = dateLine.leading ?? dateLine.size * 1.2;
    const baseline = dateLine.y + (leading - dateLine.size) / 2 + dateLine.size * 0.8 - 3;
    // centro de cada trecho de "_____" do próprio texto do modelo
    let i = 0;
    for (const m of raw.matchAll(/_+/g)) {
      const start = font.widthOfTextAtSize(raw.slice(0, m.index), dateLine.size);
      const width = font.widthOfTextAtSize(m[0], dateLine.size);
      if (today[i]) write(decl, today[i], dateLine.x + start + width / 2, baseline, width, { center: true });
      i++;
    }
  }

  doc.addPage(back);
  return Buffer.from(await doc.save());
}
