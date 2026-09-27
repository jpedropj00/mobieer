/**
 * Leitura das notas que a contabilidade manda (só para registro — nada é
 * emitido). Aceita NF-e (modelo 55/65), NFS-e no padrão ABRASF e NFS-e do
 * padrão nacional, além do evento de cancelamento da NF-e.
 *
 * É leitura por marcação, sem validar o schema: pega o que interessa para o
 * cadastro e deixa a pessoa conferir antes de salvar. O que não for achado
 * volta vazio, nunca inventado.
 */

export type ParsedInvoice = {
  kind: "NFE" | "NFSE";
  number: string | null;
  series: string | null;
  accessKey: string | null;
  issuedAt: string | null; // ISO
  amount: number | null;
  issuer: { name: string | null; document: string | null };
  recipient: { name: string | null; document: string | null };
  description: string | null;
};

export type ParsedXml =
  | { type: "INVOICE"; invoice: ParsedInvoice; warnings: string[] }
  | { type: "CANCELLATION"; accessKey: string; at: string | null; reason: string | null }
  | { type: "UNKNOWN"; reason: string };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

/** Tira prefixos de namespace (<ns2:nNF> vira <nNF>) para as buscas valerem para qualquer emissor. */
function normalize(xml: string) {
  return xml.replace(/^﻿/, "").replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");
}

/** Conteúdo do primeiro elemento com esse nome (dentro de `xml`). */
function block(xml: string | null, name: string): string | null {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}
function text(xml: string | null, ...names: string[]): string | null {
  for (const n of names) {
    const b = block(xml, n);
    if (b != null && !/<\w/.test(b)) {
      const v = decode(b);
      if (v) return v;
    }
  }
  return null;
}
const money = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const digits = (v: string | null) => (v ? v.replace(/\D/g, "") || null : null);
/** Data da nota: aceita "2026-09-10T14:32:00-03:00" e "2026-09-10". */
const isoDate = (v: string | null) => {
  if (!v) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00-03:00`) : new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const party = (xml: string | null, nameTags: string[]) => ({
  name: text(xml, ...nameTags),
  document: digits(text(xml, "CNPJ", "CPF", "Cnpj", "Cpf")),
});

function parseNfe(x: string): ParsedXml {
  const inf = block(x, "infNFe")!;
  const idAttr = x.match(/<infNFe[^>]*\sId="NFe(\d{44})"/);
  const accessKey = text(x, "chNFe") ?? idAttr?.[1] ?? null;
  const ide = block(inf, "ide");
  const itens = [...inf.matchAll(/<xProd>([\s\S]*?)<\/xProd>/g)].map((m) => decode(m[1]));
  const warnings: string[] = [];
  const protocol = block(x, "protNFe");
  if (!protocol) warnings.push("XML sem protocolo de autorização (pode ser só o arquivo assinado, não autorizado).");
  const cStat = text(protocol, "cStat");
  if (cStat && cStat !== "100" && cStat !== "150") warnings.push(`Situação na SEFAZ: ${cStat} — ${text(protocol, "xMotivo") ?? "sem motivo"}`);
  return {
    type: "INVOICE",
    warnings,
    invoice: {
      kind: "NFE",
      number: text(ide, "nNF"),
      series: text(ide, "serie"),
      accessKey,
      issuedAt: isoDate(text(ide, "dhEmi", "dEmi")),
      amount: money(text(block(inf, "ICMSTot"), "vNF")),
      issuer: party(block(inf, "emit"), ["xNome"]),
      recipient: party(block(inf, "dest"), ["xNome"]),
      description: itens.length ? itens.slice(0, 5).join("; ") + (itens.length > 5 ? ` e mais ${itens.length - 5}` : "") : null,
    },
  };
}

function parseNfseNacional(x: string): ParsedXml {
  const inf = block(x, "infNFSe") ?? x;
  const dps = block(x, "infDPS");
  const idAttr = x.match(/<infNFSe[^>]*\sId="NFS(\d{50})"/);
  return {
    type: "INVOICE",
    warnings: [],
    invoice: {
      kind: "NFSE",
      number: text(inf, "nNFSe"),
      series: text(dps, "serie"),
      accessKey: idAttr?.[1] ?? null,
      issuedAt: isoDate(text(inf, "dhProc") ?? text(dps, "dhEmi")),
      amount: money(text(block(inf, "valores"), "vLiq") ?? text(block(dps, "valores"), "vServ") ?? text(x, "vServ")),
      issuer: party(block(inf, "emit"), ["xNome"]),
      recipient: party(block(dps, "toma"), ["xNome"]),
      description: text(dps, "xDescServ"),
    },
  };
}

function parseNfseAbrasf(x: string): ParsedXml {
  const inf = block(x, "InfNfse") ?? x;
  const valores = block(inf, "Valores") ?? block(inf, "ValoresNfse") ?? inf;
  const prestador = block(inf, "PrestadorServico") ?? block(inf, "Prestador");
  const tomador = block(inf, "TomadorServico") ?? block(inf, "Tomador");
  return {
    type: "INVOICE",
    warnings: [],
    invoice: {
      kind: "NFSE",
      number: text(inf, "Numero"),
      series: text(block(inf, "IdentificacaoRps"), "Serie"),
      accessKey: text(inf, "CodigoVerificacao"),
      issuedAt: isoDate(text(inf, "DataEmissao")),
      amount: money(text(valores, "ValorLiquidoNfse") ?? text(valores, "ValorServicos") ?? text(inf, "ValorServicos")),
      issuer: party(prestador, ["RazaoSocial", "NomeFantasia"]),
      recipient: party(tomador, ["RazaoSocial"]),
      description: text(inf, "Discriminacao"),
    },
  };
}

export function parseInvoiceXml(raw: string): ParsedXml {
  const x = normalize(raw);
  if (/<procEventoNFe|<evento[\s>]/.test(x) && text(x, "tpEvento") === "110111") {
    const key = text(x, "chNFe");
    if (!key) return { type: "UNKNOWN", reason: "Evento de cancelamento sem chave da nota" };
    return { type: "CANCELLATION", accessKey: key, at: isoDate(text(x, "dhEvento")), reason: text(x, "xJust") };
  }
  if (block(x, "infNFe")) return parseNfe(x);
  if (block(x, "infNFSe") || block(x, "infDPS")) return parseNfseNacional(x);
  if (block(x, "InfNfse") || block(x, "CompNfse")) return parseNfseAbrasf(x);
  return { type: "UNKNOWN", reason: "Não parece uma NF-e nem uma NFS-e" };
}

/**
 * Saída (a empresa emitiu) ou entrada (a empresa recebeu), pelo CNPJ da
 * empresa. Sem CNPJ cadastrado, a pessoa escolhe.
 */
export function invoiceDirection(inv: ParsedInvoice, companyDocument: string | null): "SAIDA" | "ENTRADA" | null {
  const doc = digits(companyDocument);
  if (!doc) return null;
  if (inv.issuer.document === doc) return "SAIDA";
  if (inv.recipient.document === doc) return "ENTRADA";
  return null;
}
