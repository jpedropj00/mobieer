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
  | "valor";

/** Sinônimos já normalizados (minúsculas, sem acento, sem espaço/pontuação). */
const SYNONYMS: Record<CsvField, string[]> = {
  descricao: ["descricao", "peca", "nomepeca", "nome", "item", "descricaopeca", "componente", "description", "part"],
  quantidade: ["quantidade", "qtd", "qtde", "quant", "qt", "repeticoes", "quantity", "qty"],
  comprimento: ["comprimento", "compr", "comp", "altura", "c", "length", "l1", "dimensao1"],
  largura: ["largura", "larg", "l", "width", "l2", "dimensao2"],
  espessura: ["espessura", "esp", "e", "thickness"],
  material: ["material", "chapa", "cor", "materialchapa", "acabamento", "padrao"],
  ambiente: ["ambiente", "local", "room"],
  modulo: ["modulo", "movel", "modulos", "module"],
  referencia: ["referencia", "ref", "codigo", "cod", "code", "reference"],
  borda: ["borda", "fita", "fitas", "bordas", "fitaborda", "edge", "edges"],
  valor: ["valor", "preco", "valortotal", "precototal", "total", "price"],
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
};

export type CsvResult = PromobParsed & {
  pecas: CsvPeca[];
  materiais: { material: string; pecas: number; areaM2: number }[];
  columns: { recognized: Partial<Record<CsvField, string>>; unknown: string[]; delimiter: string };
  warnings: string[];
};

const MAX_ROWS = 5000;

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
  const pecas: CsvPeca[] = [];
  let ignoradas = 0;
  for (const r of rows.slice(1, MAX_ROWS + 1)) {
    const descricao = get(r, "descricao");
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
      borda: get(r, "borda") || null,
      valor: num(get(r, "valor")),
      areaM2: comprimento != null && largura != null ? Math.round(((comprimento * largura * quantidade) / 1_000_000) * 1000) / 1000 : null,
    });
  }
  if (rows.length - 1 > MAX_ROWS) warnings.push(`Arquivo com mais de ${MAX_ROWS} linhas: só as primeiras ${MAX_ROWS} foram lidas.`);
  if (ignoradas) warnings.push(`${ignoradas} linha(s) sem descrição foram ignoradas.`);

  const porMaterial = new Map<string, { pecas: number; areaM2: number }>();
  for (const p of pecas) {
    const k = p.material ?? "(sem material)";
    const cur = porMaterial.get(k) ?? { pecas: 0, areaM2: 0 };
    cur.pecas += p.quantidade;
    cur.areaM2 += p.areaM2 ?? 0;
    porMaterial.set(k, cur);
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
      .map(([material, v]) => ({ material, pecas: v.pecas, areaM2: Math.round(v.areaM2 * 1000) / 1000 }))
      .sort((a, b) => b.areaM2 - a.areaM2),
    columns: {
      recognized: Object.fromEntries(Object.entries(map).map(([f, i]) => [f, header[i!].trim()])) as Partial<Record<CsvField, string>>,
      unknown,
      delimiter: delimiter === "\t" ? "TAB" : delimiter,
    },
    warnings,
  };
}
