/**
 * Leitura "best-effort" da exportação do Promob. O Promob não tem API pública;
 * a troca é por arquivo (XML de orçamento / plano de corte, às vezes PDF).
 * O formato do XML varia por versão, então extraímos o que der por regex e
 * guardamos o arquivo original para conferência manual.
 */

export type PromobParsed = {
  ambientes: string[];
  itens: { descricao: string; referencia?: string | null; quantidade?: number | null; ambiente?: string | null }[];
  totals: { ambientes: number; itens: number };
  raw?: { attrHits: number };
};

export function detectFormat(fileName: string, mime: string): "XML" | "PDF" | "OTHER" {
  if (/\.xml$/i.test(fileName) || mime.includes("xml")) return "XML";
  if (/\.pdf$/i.test(fileName) || mime.includes("pdf")) return "PDF";
  return "OTHER";
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1].trim() || null : null;
}

export function parsePromobXml(xml: string): PromobParsed {
  const ambientes = new Set<string>();
  const itens: PromobParsed["itens"] = [];

  // <AMBIENTE ... DESCRICAO="Cozinha" ...>
  for (const m of xml.matchAll(/<AMBIENTE\b[^>]*>/gi)) {
    const d = attr(m[0], "DESCRICAO") || attr(m[0], "DESCRIPTION") || attr(m[0], "NAME");
    if (d) ambientes.add(d);
  }

  // <ITEM ... DESCRICAO="..." REFERENCIA="..." REPETICOES="1">
  let attrHits = 0;
  for (const m of xml.matchAll(/<ITEM\b[^>]*>/gi)) {
    const tag = m[0];
    const descricao = attr(tag, "DESCRICAO") || attr(tag, "DESCRIPTION");
    if (!descricao) continue;
    attrHits++;
    const qtdRaw = attr(tag, "REPETICOES") || attr(tag, "QUANTIDADE") || attr(tag, "QTD") || attr(tag, "QUANTITY");
    const q = qtdRaw ? Number(qtdRaw.replace(",", ".")) : null;
    itens.push({
      descricao,
      referencia: attr(tag, "REFERENCIA") || attr(tag, "REFERENCE") || attr(tag, "CODIGO"),
      quantidade: q != null && !Number.isNaN(q) ? q : null,
      ambiente: attr(tag, "AMBIENTE") || null,
    });
    if (itens.length >= 2000) break; // trava de segurança
  }

  const list = [...ambientes];
  return { ambientes: list, itens, totals: { ambientes: list.length, itens: itens.length }, raw: { attrHits } };
}
