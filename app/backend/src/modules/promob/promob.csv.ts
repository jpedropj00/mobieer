/**
 * §20 — Leitura do CSV exportado pelo Promob (plano de corte / lista de peças).
 *
 * Cada instalação exporta colunas com nomes diferentes ("Qtde", "Quantidade",
 * "QTD"; "Comprimento", "Altura", "C"), com ";" ou "," ou TAB, em UTF-8 ou
 * Windows-1252. Em vez de exigir um layout, o cabeçalho é casado com sinônimos
 * e o resultado diz quais colunas foram reconhecidas — é isso que a prévia
 * mostra antes de salvar.
 */
import type { PromobParsed } from "./promob.service";
import { parseMoney } from "./promob.service";

export type CsvField =
  | "descricao"
  | "quantidade"
  | "comprimento"
  | "largura"
  | "espessura"
  | "material"
  | "ambiente"
  | "modulo"
  | "referencia"
  | "borda"
  | "valor"
  // exportação do plugin de corte (uma linha por canto da peça)
  | "pecaId"
  | "temMateria"
  | "chapaX"
  | "chapaY"
  | "pontoX"
  | "pontoY";

/** Sinônimos já normalizados (minúsculas, sem acento, sem espaço/pontuação). */
const SYNONYMS: Record<CsvField, string[]> = {
  descricao: ["descricao", "peca", "nomepeca", "nome", "item", "descricaopeca", "pecadescricao", "componente", "description", "part"],
  quantidade: ["quantidade", "qtd", "qtde", "quant", "qt", "repeticoes", "quantidadeitem", "quantity", "qty"],
  comprimento: ["comprimento", "compr", "comp", "altura", "alturax", "c", "length", "l1", "dimensao1"],
  largura: ["largura", "larg", "l", "profy", "profundidade", "width", "l2", "dimensao2"],
  espessura: ["espessura", "esp", "e", "espessuraitem", "thickness"],
  material: ["material", "chapa", "cor", "materialchapa", "descricaodomaterial", "acabamento", "padrao"],
  ambiente: ["ambiente", "local", "room"],
  modulo: ["modulo", "movel", "modulos", "idmodulo", "module"],
  referencia: ["referencia", "ref", "codigo", "cod", "code", "reference"],
  borda: ["borda", "fita", "fitas", "bordas", "fitaborda", "descricaofitaborda", "edge", "edges"],
  valor: ["valor", "preco", "valortotal", "precototal", "total", "price"],
  pecaId: ["pecaid", "idpeca", "iddapeca"],
  temMateria: ["itemtemmateriaprima", "temmateriaprima"],
  chapaX: ["dimxmaterial"],
  chapaY: ["dimymaterial"],
  pontoX: ["pontoxitem"],
  pontoY: ["pontoyitem"],
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Decodifica o arquivo: BOM UTF-8/16; sem BOM, UTF-8 se for válido, senão Windows-1252. */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  const utf8 = buf.toString("utf8");
  // U+FFFD = byte que não forma UTF-8 válido: era Latin-1/Windows-1252
  return utf8.includes("�") ? buf.toString("latin1") : utf8;
}

/** Separador pela primeira linha: o que mais aparece fora de aspas entre ; , e TAB. */
export function detectDelimiter(firstLine: string): ";" | "," | "\t" {
  const count = (d: string) => {
    let n = 0;
    let q = false;
    for (const ch of firstLine) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    return n;
  };
  const c = { ";": count(";"), ",": count(","), "\t": count("\t") };
  return (Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as ";" | "," | "\t") ?? ";";
}

/** Divide o CSV em linhas/células respeitando aspas (inclusive quebra de linha dentro de aspas). */
export function splitCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Casa cada coluna do cabeçalho com um campo conhecido; a primeira ocorrência vence. */
export function mapHeader(header: string[]): { map: Partial<Record<CsvField, number>>; unknown: string[] } {
  const map: Partial<Record<CsvField, number>> = {};
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const n = norm(h);
    const field = (Object.keys(SYNONYMS) as CsvField[]).find((f) => SYNONYMS[f].includes(n));
    if (field && map[field] === undefined) map[field] = i;
    else if (h.trim()) unknown.push(h.trim());
  });
  return { map, unknown };
}

const num = (raw: string | undefined) => {
  if (raw == null || raw.trim() === "") return null;
  // "2.750" em planilha BR é dois mil e setecentos e cinquenta, não 2,75
  if (/^\d{1,3}(\.\d{3})+$/.test(raw.trim())) return Number(raw.trim().replace(/\./g, ""));
  return parseMoney(raw);
};

export type CsvPeca = {
  descricao: string;
  quantidade: number;
  comprimento: number | null;
  largura: number | null;
  espessura: number | null;
  material: string | null;
  ambiente: string | null;
  modulo: string | null;
  referencia: string | null;
  borda: string | null;
  valor: number | null;
  /** Área total em m², com as medidas em mm. */
  areaM2: number | null;
  /** Metros de fita de borda (lados com fita), quando o arquivo traz os cantos da peça. */
  fitaM?: number | null;
  /** Tamanho da chapa do material (mm), quando o arquivo informa. */
  chapa?: { x: number; y: number } | null;
};

export type CsvResult = PromobParsed & {
  pecas: CsvPeca[];
  materiais: { material: string; pecas: number; areaM2: number; chapaM2?: number | null; chapas?: number | null }[];
  fitas?: { fita: string; metros: number }[];
  columns: { recognized: Partial<Record<CsvField, string>>; unknown: string[]; delimiter: string };
  warnings: string[];
};

const MAX_ROWS = 5000;
/** Perda de corte usada na estimativa de chapas. */
export const CUT_LOSS = 0.1;

export function parsePromobCsv(buf: Buffer): CsvResult {
  const text = decodeText(buf);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows = splitCsv(text, delimiter);
  const warnings: string[] = [];
  if (rows.length < 2) throw new Error("O arquivo não tem linhas de dados depois do cabeçalho");

  const header = rows[0];
  const { map, unknown } = mapHeader(header);
  if (map.descricao === undefined) {
    throw new Error(`Não encontrei a coluna de descrição/peça. Colunas do arquivo: ${header.map((h) => h.trim()).filter(Boolean).join(", ")}`);
  }
  if (map.quantidade === undefined) warnings.push("Sem coluna de quantidade: cada linha contou como 1 peça.");
  if (map.comprimento === undefined || map.largura === undefined) warnings.push("Sem comprimento e largura: a área por material não pôde ser calculada.");

  const get = (r: string[], f: CsvField) => (map[f] === undefined ? undefined : r[map[f]!]?.trim());

  // Exportação do plugin de corte: a peça vem repetida, uma linha por canto
  // (cada uma com a fita daquele lado), e as linhas sem matéria-prima são só
  // o agrupamento (módulo/grupo). Junta por ID da peça e descarta o agrupamento.
  let dataRows = rows.slice(1, MAX_ROWS + 1);
  const cantos = new Map<string, string[][]>();
  if (map.temMateria !== undefined) {
    const antes = dataRows.length;
    dataRows = dataRows.filter((r) => !/^(0|false|nao|não|n)?$/i.test(get(r, "temMateria") ?? ""));
    if (antes - dataRows.length) warnings.push(`${antes - dataRows.length} linha(s) de agrupamento (módulo/grupo, sem matéria-prima) não entraram como peça.`);
  }
  if (map.pecaId !== undefined) {
    const primeiras: string[][] = [];
    for (const r of dataRows) {
      const id = get(r, "pecaId") || `linha-${primeiras.length}`;
      if (!cantos.has(id)) {
        cantos.set(id, []);
        primeiras.push(r);
      }
      cantos.get(id)!.push(r);
    }
    if (primeiras.length < dataRows.length) warnings.push(`Arquivo com uma linha por canto da peça: ${dataRows.length} linhas viraram ${primeiras.length} peças.`);
    dataRows = primeiras;
  }
  /** Metros de fita: soma dos lados (canto a canto) cuja linha traz fita. */
  const fitaDe = (r: string[]) => {
    if (map.pecaId === undefined || map.pontoX === undefined || map.pontoY === undefined) return null;
    const pts = cantos.get(get(r, "pecaId") || "") ?? [];
    if (pts.length < 2) return null;
    let mm = 0;
    pts.forEach((pt, i) => {
      if (!get(pt, "borda")) return;
      const nx = pts[(i + 1) % pts.length];
      const dx = (num(get(nx, "pontoX")) ?? 0) - (num(get(pt, "pontoX")) ?? 0);
      const dy = (num(get(nx, "pontoY")) ?? 0) - (num(get(pt, "pontoY")) ?? 0);
      mm += Math.hypot(dx, dy);
    });
    return Math.round(mm) / 1000;
  };

  const pecas: CsvPeca[] = [];
  let ignoradas = 0;
  for (const r of dataRows) {
    const descricao = get(r, "descricao")?.replace(/_+$/, "").trim();
    if (!descricao) {
      ignoradas++;
      continue;
    }
    const qtd = num(get(r, "quantidade"));
    const quantidade = qtd != null && qtd > 0 ? Math.round(qtd) : 1;
    const comprimento = num(get(r, "comprimento"));
    const largura = num(get(r, "largura"));
    pecas.push({
      descricao,
      quantidade,
      comprimento,
      largura,
      espessura: num(get(r, "espessura")),
      material: get(r, "material") || null,
      ambiente: get(r, "ambiente") || null,
      modulo: get(r, "modulo") || null,
      referencia: get(r, "referencia") || null,
      // no formato por canto, a fita pode não estar no primeiro canto: vale a primeira que aparecer
      borda: get(r, "borda") || (cantos.get(get(r, "pecaId") || "") ?? []).map((c) => get(c, "borda")).find(Boolean) || null,
      valor: num(get(r, "valor")),
      areaM2: comprimento != null && largura != null ? Math.round(((comprimento * largura * quantidade) / 1_000_000) * 1000) / 1000 : null,
      fitaM: (() => {
        const f = fitaDe(r);
        return f == null ? null : Math.round(f * quantidade * 1000) / 1000;
      })(),
      chapa: (() => {
        const x = num(get(r, "chapaX"));
        const y = num(get(r, "chapaY"));
        return x && y ? { x, y } : null;
      })(),
    });
  }
  if (rows.length - 1 > MAX_ROWS) warnings.push(`Arquivo com mais de ${MAX_ROWS} linhas: só as primeiras ${MAX_ROWS} foram lidas.`);
  if (ignoradas) warnings.push(`${ignoradas} linha(s) sem descrição foram ignoradas.`);

  const porMaterial = new Map<string, { pecas: number; areaM2: number; chapaM2: number | null }>();
  const porFita = new Map<string, number>();
  for (const p of pecas) {
    const k = p.material ?? "(sem material)";
    const cur = porMaterial.get(k) ?? { pecas: 0, areaM2: 0, chapaM2: null };
    cur.pecas += p.quantidade;
    cur.areaM2 += p.areaM2 ?? 0;
    if (p.chapa) cur.chapaM2 = (p.chapa.x * p.chapa.y) / 1_000_000;
    porMaterial.set(k, cur);
    if (p.borda && p.fitaM) porFita.set(p.borda, (porFita.get(p.borda) ?? 0) + p.fitaM);
  }
  const ambientes = [...new Set(pecas.map((p) => p.ambiente).filter((x): x is string => !!x))];
  const valor = pecas.some((p) => p.valor != null) ? Math.round(pecas.reduce((s, p) => s + (p.valor ?? 0), 0) * 100) / 100 : null;

  return {
    ambientes,
    // `itens` é o formato que o resto do sistema já consome (gerar itens de produção)
    itens: pecas.map((p) => ({
      descricao: [p.modulo, p.descricao].filter(Boolean).join(" — "),
      referencia: p.referencia,
      quantidade: p.quantidade,
      ambiente: p.ambiente,
      valorUnitario: null,
      valorTotal: p.valor,
    })),
    totals: { ambientes: ambientes.length, itens: pecas.length, valor },
    pecas,
    materiais: [...porMaterial.entries()]
      .map(([material, v]) => ({
        material,
        pecas: v.pecas,
        areaM2: Math.round(v.areaM2 * 1000) / 1000,
        chapaM2: v.chapaM2 == null ? null : Math.round(v.chapaM2 * 1000) / 1000,
        // chapas pela área das peças + perda de corte (estimativa: o plano de corte real pode dar outra conta)
        chapas: v.chapaM2 && v.areaM2 > 0 ? Math.ceil((v.areaM2 * (1 + CUT_LOSS)) / v.chapaM2) : null,
      }))
      .sort((a, b) => b.areaM2 - a.areaM2),
    fitas: [...porFita.entries()].map(([fita, metros]) => ({ fita, metros: Math.round(metros * 100) / 100 })).sort((a, b) => b.metros - a.metros),
    columns: {
      recognized: Object.fromEntries(Object.entries(map).map(([f, i]) => [f, header[i!].trim()])) as Partial<Record<CsvField, string>>,
      unknown,
      delimiter: delimiter === "\t" ? "TAB" : delimiter,
    },
    warnings,
  };
}
