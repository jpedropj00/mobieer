/**
 * Comparação de duas listas de peças do Promob do mesmo projeto (ex.: a do
 * orçamento e a do projeto executivo): o que ficou igual, o que mudou, o que
 * saiu e o que entrou. Serve para conferir a revisão antes de mandar à fábrica.
 *
 * A peça é identificada pela referência (dentro do ambiente) quando o arquivo
 * traz; senão por ambiente + módulo + descrição. Referência repetida vira
 * "referência #2", "#3"... na ordem do arquivo.
 */

export type ComparablePart = {
  ambiente: string | null;
  modulo: string | null;
  descricao: string;
  referencia: string | null;
  quantidade: number;
  comprimento: number | null;
  largura: number | null;
  espessura: number | null;
  material: string | null;
  borda: string | null;
  valor: number | null;
};

export type PartChange = { field: keyof ComparablePart; label: string; before: string | number | null; after: string | number | null };
export type DiffRow = {
  status: "IGUAL" | "ALTERADA" | "EXCLUIDA" | "NOVA";
  key: string;
  ambiente: string | null;
  descricao: string;
  referencia: string | null;
  before: ComparablePart | null;
  after: ComparablePart | null;
  changes: PartChange[];
};

const FIELDS: { field: keyof ComparablePart; label: string }[] = [
  { field: "quantidade", label: "Quantidade" },
  { field: "comprimento", label: "Comprimento" },
  { field: "largura", label: "Largura" },
  { field: "espessura", label: "Espessura" },
  { field: "material", label: "Material" },
  { field: "borda", label: "Borda" },
  { field: "valor", label: "Valor" },
];

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Lista comparável a partir do parsedJson (CSV tem `pecas`; XML tem `itens`). */
export function partsFromParsed(parsed: unknown): ComparablePart[] {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as { pecas?: Record<string, unknown>[]; itens?: Record<string, unknown>[] };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const s = (v: unknown) => (v == null || v === "" ? null : String(v));
  if (Array.isArray(p.pecas) && p.pecas.length) {
    return p.pecas.map((x) => ({
      ambiente: s(x.ambiente),
      modulo: s(x.modulo),
      descricao: String(x.descricao ?? ""),
      referencia: s(x.referencia),
      quantidade: n(x.quantidade) ?? 1,
      comprimento: n(x.comprimento),
      largura: n(x.largura),
      espessura: n(x.espessura),
      material: s(x.material),
      borda: s(x.borda),
      valor: n(x.valor),
    }));
  }
  return (p.itens ?? []).map((x) => ({
    ambiente: s(x.ambiente),
    modulo: null,
    descricao: String(x.descricao ?? ""),
    referencia: s(x.referencia),
    quantidade: n(x.quantidade) ?? 1,
    comprimento: null,
    largura: null,
    espessura: null,
    material: null,
    borda: null,
    valor: n(x.valorTotal),
  }));
}

function keyed(parts: ComparablePart[]) {
  const seen = new Map<string, number>();
  const out = new Map<string, ComparablePart>();
  for (const p of parts) {
    const base = p.referencia ? `${norm(p.ambiente)}|ref:${norm(p.referencia)}` : `${norm(p.ambiente)}|${norm(p.modulo)}|${norm(p.descricao)}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    out.set(k === 1 ? base : `${base}#${k}`, p);
  }
  return out;
}

const same = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 0.005 : norm(a == null ? null : String(a)) === norm(b == null ? null : String(b)));

export function diffParts(before: ComparablePart[], after: ComparablePart[]) {
  const A = keyed(before);
  const B = keyed(after);
  const rows: DiffRow[] = [];
  for (const [key, a] of A) {
    const b = B.get(key);
    if (!b) {
      rows.push({ status: "EXCLUIDA", key, ambiente: a.ambiente, descricao: a.descricao, referencia: a.referencia, before: a, after: null, changes: [] });
      continue;
    }
    const changes = FIELDS.filter(({ field }) => !same(a[field], b[field])).map(({ field, label }) => ({ field, label, before: a[field], after: b[field] }));
    rows.push({ status: changes.length ? "ALTERADA" : "IGUAL", key, ambiente: b.ambiente, descricao: b.descricao, referencia: b.referencia, before: a, after: b, changes });
  }
  for (const [key, b] of B) {
    if (!A.has(key)) rows.push({ status: "NOVA", key, ambiente: b.ambiente, descricao: b.descricao, referencia: b.referencia, before: null, after: b, changes: [] });
  }
  const order = { ALTERADA: 0, NOVA: 1, EXCLUIDA: 2, IGUAL: 3 } as const;
  rows.sort((x, y) => order[x.status] - order[y.status] || norm(x.ambiente).localeCompare(norm(y.ambiente)) || norm(x.descricao).localeCompare(norm(y.descricao)));
  const count = (s: DiffRow["status"]) => rows.filter((r) => r.status === s).length;
  return { summary: { iguais: count("IGUAL"), alteradas: count("ALTERADA"), excluidas: count("EXCLUIDA"), novas: count("NOVA") }, rows };
}
