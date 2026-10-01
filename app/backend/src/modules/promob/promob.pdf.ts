/**
 * Leitura dos PDFs do Promob (texto, não imagem):
 *  - "Orçamento" do Promob Studio: cliente, projeto, seções (Cozinhas,
 *    Dormitórios, Ferragens...) com itens e preço, total final, descontos e
 *    condição de pagamento; depois a lista de insumos sem preço (chapas em m²,
 *    fitas, ferragens e operações).
 *  - Plano de corte ("Preview de corte"): uma chapa por página, com material,
 *    dimensão, peças, cortes e aproveitamento.
 *
 * O PDF não tem tabela: o texto vem solto com a posição de cada pedaço. As
 * linhas são remontadas pela altura (y) e as colunas pela posição (x).
 */
import { parseMoney, type PromobParsed } from "./promob.service";

export type PdfCell = { x: number; s: string };
export type PdfLine = { page: number; y: number; cells: PdfCell[] };

/** Texto da linha, na ordem da esquerda para a direita. */
const lineText = (l: PdfLine) => l.cells.map((c) => c.s).join(" ").replace(/\s+/g, " ").trim();
const num = (s: string | undefined | null) => (s == null ? null : parseMoney(s));

/** Extrai as linhas posicionadas de cada página. */
export async function extractPdfLines(buf: Buffer): Promise<PdfLine[]> {
  // o index do pdf-parse roda um autoteste ao ser importado; o arquivo interno não
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (b: Buffer, o: object) => Promise<unknown>;
  const out: PdfLine[] = [];
  let page = 0;
  await pdfParse(buf, {
    pagerender: async (p: { getTextContent: (o: object) => Promise<{ items: { str: string; transform: number[] }[] }> }) => {
      page++;
      const tc = await p.getTextContent({ normalizeWhitespace: true });
      const rows = new Map<number, PdfCell[]>();
      for (const it of tc.items) {
        if (!it.str.trim()) continue;
        const y = Math.round(it.transform[5]);
        // pedaços da mesma linha podem variar 1-2 pontos na altura
        const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key)!.push({ x: Math.round(it.transform[4]), s: it.str.trim() });
      }
      for (const [y, cells] of [...rows.entries()].sort((a, b) => b[0] - a[0])) out.push({ page, y, cells: cells.sort((a, b) => a.x - b.x) });
      return "";
    },
  });
  return out;
}

export type PdfKind = "BUDGET" | "CUT_PLAN" | "UNKNOWN";

export function detectPdfKind(lines: PdfLine[]): PdfKind {
  const head = lines.slice(0, 400).map(lineText).join("\n");
  if (/Aproveitamento:/.test(head) && /Chapa\s+\d+/.test(head)) return "CUT_PLAN";
  if (/Refer[êe]ncia/.test(head) && /Descri[çc][ãa]o/.test(head) && /Dimens[õo]es/.test(head)) return "BUDGET";
  return "UNKNOWN";
}

// ------------------------------------------------------------------ orçamento

export type BudgetItem = { item: string; secao: string | null; quantidade: number; unidade: string | null; referencia: string | null; descricao: string; dimensoes: string | null; valor: number | null };
export type BudgetResult = PromobParsed & {
  kind: "BUDGET";
  cliente: { nome: string | null; celular: string | null; email: string | null };
  projeto: string | null;
  totalFinal: number | null;
  descontos: { descricao: string; valor: number }[];
  pagamento: { descricao: string; valorParcelar: number | null; valorParcela: number | null; valorTotal: number | null }[];
  itensSemPreco: number;
  /** Lista sem preço do fim do PDF, resumida. */
  insumos: {
    chapas: { material: string; m2: number }[];
    fitasM: number;
    ferragens: { descricao: string; quantidade: number }[];
    operacoes: { descricao: string; unidade: string; quantidade: number }[];
  };
  warnings: string[];
};

/** "1 UN", "4.2032 M", "0.7734 M2" */
function qtyUnit(raw: string): { q: number; un: string | null } {
  const m = raw.trim().match(/^([\d.,]+)\s*([A-Za-z0-9²]+)?$/);
  if (!m) return { q: 1, un: null };
  // nesta lista a quantidade usa ponto decimal ("1.74 M")
  const q = Number(m[1].replace(",", "."));
  return { q: Number.isFinite(q) ? q : 1, un: m[2] ?? null };
}

export function parseBudgetLines(lines: PdfLine[]): BudgetResult {
  const warnings: string[] = [];
  const cliente = { nome: null as string | null, celular: null as string | null, email: null as string | null };
  let projeto: string | null = null;
  let secao: string | null = null;
  let priced = true; // muda quando o cabeçalho deixa de ter a coluna Preço
  let totalFinal: number | null = null;
  const itens: BudgetItem[] = [];
  const subtotais = new Map<string, number>();
  const descontos: BudgetResult["descontos"] = [];
  const pagamento: BudgetResult["pagamento"] = [];
  const chapas = new Map<string, number>();
  const ferragens = new Map<string, number>();
  const operacoes = new Map<string, { unidade: string; quantidade: number }>();
  let fitasMm = 0;
  let zona: "ITENS" | "DESCONTOS" | "PAGAMENTO" = "ITENS";

  // posição das colunas pelo cabeçalho (muda entre a parte com preço e a sem preço)
  let col = { ref: 142, desc: 288, dim: 418, price: 505 };
  type Row = { line: PdfLine; item: BudgetItem; inlineDesc: boolean };
  const rows: Row[] = [];
  const insumoRows: { row: Row; q: number }[] = [];
  const descOnly: PdfLine[] = [];

  for (const l of lines) {
    const t = lineText(l);
    const first = l.cells[0];
    if (/^Data:.*Or[çc]amento$/.test(t) || /Promob Studio/.test(t) || /^Raz[ãa]o social/.test(t)) continue;
    if (/^Nome:/.test(t)) { cliente.nome = l.cells.find((c) => c.x > 90 && c.x < 300 && !/^Nome:?$/.test(c.s))?.s ?? null; continue; }
    if (/Celular:/.test(t)) { cliente.celular = t.match(/Celular:\s*([\d() +-]{8,})/)?.[1]?.trim() ?? null; continue; }
    if (/mail:/.test(t)) { cliente.email = t.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? null; continue; }
    if (/^(Dados do cliente|Endere[çc]o:|Bairro:|End\. Entrega:|Telefone:)/.test(t)) continue;
    if (/^Projeto\s*-/.test(t)) { projeto = t.replace(/^Projeto\s*-\s*/, "").trim() || null; continue; }
    if (/^Total final:/.test(t)) { totalFinal = num(t.replace(/^Total final:/, "")); continue; }
    if (/^Entradas Diferenciadas/.test(t)) { zona = "DESCONTOS"; continue; }
    if (/^Condi[çc][õo]es de Pagamento/.test(t)) { zona = "PAGAMENTO"; continue; }
    if (/^O Or[çc]amento possui itens|^contactada, pois/.test(t)) continue;

    // cabeçalho da tabela: define as colunas e se há preço
    if (first?.s.startsWith("Item") && /Refer/.test(t)) {
      const at = (re: RegExp) => l.cells.find((c) => re.test(c.s))?.x;
      priced = /Pre[çc]o/.test(t);
      col = { ref: (at(/Refer/) ?? 196) - 60, desc: (at(/Descri/) ?? 334) - 70, dim: (at(/Dimens/) ?? 430) - 30, price: (at(/Pre[çc]o/) ?? 9999) - 20 };
      zona = "ITENS";
      continue;
    }
    // seção: "- Cozinhas"
    if (first?.s === "-" && l.cells.length === 2 && first.x < 80) { secao = l.cells[1].s; continue; }

    if (zona === "DESCONTOS") {
      if (/^Descri[çc][ãa]o\s+Valor$/.test(t)) continue;
      const v = num(l.cells[l.cells.length - 1].s);
      if (l.cells.length >= 2 && v != null) descontos.push({ descricao: l.cells.slice(0, -1).map((c) => c.s).join(" "), valor: v });
      continue;
    }
    if (zona === "PAGAMENTO") {
      if (/^Descri[çc][ãa]o/.test(t)) continue;
      if (l.cells.length >= 4) pagamento.push({ descricao: l.cells[0].s, valorParcelar: num(l.cells[1].s), valorParcela: num(l.cells[2].s), valorTotal: num(l.cells[3].s) });
      continue;
    }

    // linha de item: começa com o número do item na margem esquerda
    if (first && first.x < 80 && /^\d+$/.test(first.s) && l.cells.length >= 3) {
      const qtdCell = l.cells.find((c) => c.x >= 105 && c.x < col.ref);
      const { q, un } = qtyUnit(qtdCell?.s ?? "1");
      const inRef = l.cells.filter((c) => c.x >= col.ref && c.x < col.desc).map((c) => c.s).join(" ").trim();
      const inDesc = l.cells.filter((c) => c.x >= col.desc && c.x < col.dim).map((c) => c.s).join(" ").trim();
      const inDim = l.cells.filter((c) => c.x >= col.dim && c.x < col.price).map((c) => c.s).join(" ").trim();
      const price = priced ? num(l.cells.filter((c) => c.x >= col.price).map((c) => c.s).join("")) : null;
      const item: BudgetItem = {
        item: first.s,
        secao,
        quantidade: q,
        unidade: un,
        referencia: inRef || null,
        descricao: inDesc,
        // na lista sem preço a coluna vem como ' - ' quando não há dimensão
        dimensoes: /^['\s-]*$/.test(inDim) ? null : inDim,
        valor: price,
      };
      rows.push({ line: l, item, inlineDesc: Boolean(inDesc) });
      if (priced) itens.push(item);
      else {
        insumoRows.push({ row: rows[rows.length - 1], q });
      }
      continue;
    }

    // subtotal da seção: só um número na coluna do preço
    if (priced && l.cells.length === 1 && first.x >= col.price && num(first.s) != null) {
      if (secao) subtotais.set(secao, Math.round(((subtotais.get(secao) ?? 0) + num(first.s)!) * 100) / 100);
      continue;
    }
    // pedaço de descrição quebrada em outra linha (em cima ou embaixo do item)
    // (dimensão que quebra de linha fica à direita da coluna de descrição e não entra aqui)
    if (l.cells.every((c) => c.x >= col.desc - 5 && c.x < col.dim)) descOnly.push(l);
  }

  // Descrição em duas linhas: a de cima e a de baixo do item ficam sem número.
  // Cada pedaço vai para o item mais próximo (na mesma página) que não tem descrição na própria linha.
  for (const d of descOnly) {
    let cand = rows.filter((r) => r.line.page === d.page && !r.inlineDesc && Math.abs(r.line.y - d.y) <= 16);
    // na lista de insumos o item pode ter só o fim da descrição na própria linha ("Branco"): o começo está logo acima
    if (!cand.length) cand = rows.filter((r) => r.line.page === d.page && r.item.valor === null && Math.abs(r.line.y - d.y) <= 9);
    if (!cand.length) continue;
    const r = cand.sort((a, b) => Math.abs(a.line.y - d.y) - Math.abs(b.line.y - d.y))[0];
    const piece = lineText(d);
    // y maior = mais acima na página: o pedaço de cima vem antes
    r.item.descricao = d.y > r.line.y ? `${piece} ${r.item.descricao}`.trim() : `${r.item.descricao} ${piece}`.trim();
  }

  // Insumos (lista sem preço), classificados depois de remontar as descrições:
  // m² = chapa; referência FT… = fita de borda; referência só numérica = operação; o resto = ferragem.
  for (const { row, q } of insumoRows) {
    const it = row.item;
    const un = (it.unidade ?? "").toUpperCase();
    const ref = it.referencia ?? "";
    const nome = it.descricao || ref || it.dimensoes || "(sem descrição)";
    if (un === "M2") chapas.set(nome, (chapas.get(nome) ?? 0) + q);
    else if (/^FT/i.test(ref)) fitasMm += q * 1000;
    else if (/^\d+$/.test(ref)) {
      const cur = operacoes.get(nome) ?? { unidade: it.unidade ?? "", quantidade: 0 };
      cur.quantidade += q;
      operacoes.set(nome, cur);
    } else ferragens.set(nome, (ferragens.get(nome) ?? 0) + q);
  }

  const semPreco = itens.filter((i) => !i.valor).length;
  if (semPreco) warnings.push(`${semPreco} de ${itens.length} itens vieram sem preço no Promob — o total (${totalFinal ?? 0}) não inclui esses itens. Confira a tabela de preços no Promob ou informe o custo no orçamento.`);
  const secoes = [...new Set(itens.map((i) => i.secao).filter((s): s is string => Boolean(s)))];
  const valoresPorAmbiente = secoes.map((s) => ({ ambiente: s, valor: subtotais.get(s) ?? Math.round(itens.filter((i) => i.secao === s).reduce((a, i) => a + (i.valor ?? 0), 0) * 100) / 100 }));

  return {
    kind: "BUDGET",
    ambientes: secoes,
    itens: itens.map((i) => ({ descricao: [i.descricao, i.dimensoes].filter(Boolean).join(" — "), referencia: i.referencia, quantidade: i.quantidade, ambiente: i.secao, valorUnitario: null, valorTotal: i.valor })),
    valoresPorAmbiente,
    totals: { ambientes: secoes.length, itens: itens.length, valor: totalFinal ?? Math.round(valoresPorAmbiente.reduce((a, v) => a + v.valor, 0) * 100) / 100 },
    cliente,
    projeto,
    totalFinal,
    descontos,
    pagamento,
    itensSemPreco: semPreco,
    insumos: {
      chapas: [...chapas.entries()].map(([material, m2]) => ({ material, m2: Math.round(m2 * 1000) / 1000 })).sort((a, b) => b.m2 - a.m2),
      fitasM: Math.round(fitasMm) / 1000,
      ferragens: [...ferragens.entries()].map(([descricao, quantidade]) => ({ descricao, quantidade: Math.round(quantidade * 100) / 100 })).sort((a, b) => b.quantidade - a.quantidade),
      operacoes: [...operacoes.entries()].map(([descricao, v]) => ({ descricao, unidade: v.unidade, quantidade: Math.round(v.quantidade * 1000) / 1000 })).sort((a, b) => b.quantidade - a.quantidade),
    },
    warnings,
  };
}

// ------------------------------------------------------------------ plano de corte

export type CutSheet = { chapa: number; material: string | null; codigo: string | null; dimensao: string | null; x: number | null; y: number | null; espessura: number | null; pecas: number | null; cortes: number | null; aproveitamento: number | null };
export type CutPlanResult = PromobParsed & {
  kind: "CUT_PLAN";
  cliente: { nome: string | null };
  projeto: string | null;
  chapas: CutSheet[];
  materiais: { material: string; pecas: number; areaM2: number; chapaM2: number | null; chapas: number; aproveitamento: number | null }[];
  warnings: string[];
};

export function parseCutPlanLines(lines: PdfLine[]): CutPlanResult {
  const byPage = new Map<number, PdfLine[]>();
  for (const l of lines) (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l);
  const sheets: CutSheet[] = [];
  let cliente: string | null = null;
  let projeto: string | null = null;
  const after = (l: PdfLine, re: RegExp) => {
    const i = l.cells.findIndex((c) => re.test(c.s));
    return i < 0 ? null : l.cells[i + 1]?.s ?? null;
  };
  for (const [, pl] of byPage) {
    const s: CutSheet = { chapa: sheets.length + 1, material: null, codigo: null, dimensao: null, x: null, y: null, espessura: null, pecas: null, cortes: null, aproveitamento: null };
    let found = false;
    for (const l of pl.slice(0, 12)) {
      const t = lineText(l);
      if (/^Cliente:/.test(t)) cliente = cliente ?? (t.replace(/^Cliente:\s*/, "") || null);
      if (/^Projeto:/.test(t)) projeto = projeto ?? (t.replace(/^Projeto:\s*/, "") || null);
      if (/^Chapa\s+\d+/.test(t)) { s.chapa = Number(t.match(/^Chapa\s+(\d+)/)![1]); found = true; }
      if (/^Descri[çc][ãa]o:/.test(t)) {
        const m = t.match(/^Descri[çc][ãa]o:\s*(.*?)\s*-\s*Cod\.:\s*(\S+)/);
        s.material = (m?.[1] ?? t.replace(/^Descri[çc][ãa]o:\s*/, "").split("Material:")[0]).trim() || null;
        s.codigo = m?.[2] ?? null;
      }
      if (/^Dimens[ãa]o:/.test(t)) {
        const m = t.match(/Dimens[ãa]o:\s*([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)/);
        if (m) { s.x = num(m[1]); s.y = num(m[2]); s.espessura = num(m[3]); s.dimensao = `${m[1]} x ${m[2]} x ${m[3]}`; }
      }
      const pe = after(l, /^Pe[çc]as:$/); if (pe) s.pecas = Number(pe) || null;
      const co = after(l, /^Cortes:$/); if (co) s.cortes = Number(co) || null;
      const ap = after(l, /^Aproveitamento:$/); if (ap) s.aproveitamento = num(ap.replace("%", ""));
    }
    if (found) sheets.push(s);
  }

  const mats = new Map<string, { pecas: number; chapas: number; chapaM2: number | null; aprov: number[] }>();
  for (const s of sheets) {
    const k = s.material ?? "(sem material)";
    const cur = mats.get(k) ?? { pecas: 0, chapas: 0, chapaM2: null, aprov: [] };
    cur.pecas += s.pecas ?? 0;
    cur.chapas += 1;
    if (s.x && s.y) cur.chapaM2 = (s.x * s.y) / 1_000_000;
    if (s.aproveitamento != null) cur.aprov.push(s.aproveitamento);
    mats.set(k, cur);
  }
  const materiais = [...mats.entries()].map(([material, v]) => {
    const media = v.aprov.length ? v.aprov.reduce((a, b) => a + b, 0) / v.aprov.length : null;
    return {
      material,
      pecas: v.pecas,
      // área das peças = área das chapas × aproveitamento de cada uma
      areaM2: v.chapaM2 && media != null ? Math.round(v.chapaM2 * v.chapas * (media / 100) * 1000) / 1000 : 0,
      chapaM2: v.chapaM2 == null ? null : Math.round(v.chapaM2 * 1000) / 1000,
      chapas: v.chapas,
      aproveitamento: media == null ? null : Math.round(media * 100) / 100,
    };
  });
  const totalPecas = sheets.reduce((a, s) => a + (s.pecas ?? 0), 0);
  return {
    kind: "CUT_PLAN",
    ambientes: projeto ? [projeto] : [],
    // o plano de corte não lista peça por peça com nome confiável: fica uma linha por chapa
    itens: sheets.map((s) => ({ descricao: `Chapa ${s.chapa} — ${s.material ?? "material"} (${s.dimensao ?? "?"})`, referencia: s.codigo, quantidade: s.pecas ?? 0, ambiente: projeto, valorUnitario: null, valorTotal: null })),
    totals: { ambientes: projeto ? 1 : 0, itens: totalPecas, valor: null },
    cliente: { nome: cliente },
    projeto,
    chapas: sheets,
    materiais,
    warnings: sheets.length ? [] : ["Não encontrei nenhuma chapa no plano de corte."],
  };
}
