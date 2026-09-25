/**
 * Leitura "best-effort" da exportação do Promob. O Promob não tem API pública;
 * a troca é por arquivo (XML de orçamento / plano de corte, às vezes PDF).
 * O formato do XML varia por versão, então extraímos o que der por regex e
 * guardamos o arquivo original para conferência manual.
 */

export type PromobParsed = {
  ambientes: string[];
  itens: {
    descricao: string;
    referencia?: string | null;
    quantidade?: number | null;
    ambiente?: string | null;
    valorUnitario?: number | null;
    valorTotal?: number | null;
  }[];
  /** Total por ambiente, quando o XML traz valores. */
  valoresPorAmbiente?: { ambiente: string; valor: number }[];
  totals: { ambientes: number; itens: number; valor?: number | null };
  raw?: { attrHits: number; valorHits?: number };
};

/**
 * Decodifica o buffer do XML respeitando a declaração `encoding=` do prólogo.
 * O Promob costuma exportar ISO-8859-1 / Windows-1252 (acentos quebram em UTF-8).
 * BOM UTF-8/UTF-16 também é tratado.
 */
export function decodeXmlBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString("utf8");
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString("utf16le");
  const head = buf.slice(0, 200).toString("latin1").toLowerCase();
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/);
  const enc = (m?.[1] ?? "utf-8").replace(/[^a-z0-9-]/g, "");
  if (enc === "iso-8859-1" || enc === "latin1" || enc === "windows-1252" || enc === "cp1252") return buf.toString("latin1");
  return buf.toString("utf8");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1].trim() || null : null;
}

/**
 * Converte um valor monetário do XML para número. O Promob exporta tanto
 * "1234.56" (ponto decimal) quanto "1.234,56" (formato BR) dependendo da
 * versão/locale da instalação.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    // vírgula é o separador decimal: remove pontos de milhar
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    // ponto é o decimal: remove vírgulas de milhar
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Primeiro atributo de valor presente na tag, na ordem de preferência. */
function money(tag: string, names: string[]): number | null {
  for (const n of names) {
    const v = parseMoney(attr(tag, n));
    if (v != null) return v;
  }
  return null;
}

const UNIT_PRICE_ATTRS = ["PRECOUNITARIO", "VALORUNITARIO", "PRECOUNIT", "UNITPRICE", "PRECO", "VALOR", "PRICE"];
const TOTAL_PRICE_ATTRS = ["PRECOTOTAL", "VALORTOTAL", "TOTAL", "TOTALPRICE", "PRECOFINAL", "VALORFINAL"];

export function parsePromobXml(xml: string): PromobParsed {
  const ambientes = new Set<string>();
  const ambienteValor = new Map<string, number>();
  const itens: PromobParsed["itens"] = [];

  // <AMBIENTE ... DESCRICAO="Cozinha" ... PRECOTOTAL="12345,67">
  for (const m of xml.matchAll(/<AMBIENTE\b[^>]*>/gi)) {
    const d = attr(m[0], "DESCRICAO") || attr(m[0], "DESCRIPTION") || attr(m[0], "NAME");
    if (!d) continue;
    ambientes.add(d);
    const v = money(m[0], TOTAL_PRICE_ATTRS);
    if (v != null && v > 0) ambienteValor.set(d, (ambienteValor.get(d) ?? 0) + v);
  }

  // <ITEM ... DESCRICAO="..." REFERENCIA="..." REPETICOES="1" PRECOTOTAL="...">
  let attrHits = 0;
  let valorHits = 0;
  for (const m of xml.matchAll(/<ITEM\b[^>]*>/gi)) {
    const tag = m[0];
    const descricao = attr(tag, "DESCRICAO") || attr(tag, "DESCRIPTION");
    if (!descricao) continue;
    attrHits++;
    const qtdRaw = attr(tag, "REPETICOES") || attr(tag, "QUANTIDADE") || attr(tag, "QTD") || attr(tag, "QUANTITY");
    const q = qtdRaw ? Number(qtdRaw.replace(",", ".")) : null;
    const quantidade = q != null && !Number.isNaN(q) ? q : null;
    const valorUnitario = money(tag, UNIT_PRICE_ATTRS);
    const valorTotal = money(tag, TOTAL_PRICE_ATTRS) ?? (valorUnitario != null ? valorUnitario * (quantidade ?? 1) : null);
    if (valorTotal != null) valorHits++;
    itens.push({
      descricao,
      referencia: attr(tag, "REFERENCIA") || attr(tag, "REFERENCE") || attr(tag, "CODIGO"),
      quantidade,
      ambiente: attr(tag, "AMBIENTE") || null,
      valorUnitario,
      valorTotal,
    });
    if (itens.length >= 2000) break; // trava de segurança
  }

  // Total do orçamento: prefere o total declarado nos ambientes; se não houver,
  // soma os itens. Evita somar os dois e dobrar o valor.
  const totalAmbientes = [...ambienteValor.values()].reduce((a, b) => a + b, 0);
  const totalItens = itens.reduce((a, i) => a + (i.valorTotal ?? 0), 0);
  const valor = totalAmbientes > 0 ? totalAmbientes : totalItens > 0 ? totalItens : null;

  const list = [...ambientes];
  return {
    ambientes: list,
    itens,
    valoresPorAmbiente: [...ambienteValor.entries()].map(([ambiente, v]) => ({ ambiente, valor: v })),
    totals: { ambientes: list.length, itens: itens.length, valor: valor != null ? Math.round(valor * 100) / 100 : null },
    raw: { attrHits, valorHits },
  };
}
