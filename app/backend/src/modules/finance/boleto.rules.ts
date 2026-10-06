/**
 * Leitura de boleto: linha digitável (47 ou 48 dígitos) ou código de barras
 * (44 dígitos). Confere os dígitos verificadores e tira valor e vencimento.
 * Regras puras — a rota só entrega o texto (digitado, lido do PDF ou da câmera).
 *
 * Boleto bancário (47/44): banco, fator de vencimento e valor estão no código.
 *   O fator voltou a 1000 em 22/02/2025 (FEBRABAN); a data certa é a mais
 *   perto de hoje entre a contagem antiga (07/10/1997) e a nova.
 * Arrecadação/concessionária (48/44 começando com 8): valor no código,
 *   vencimento não é padronizado (fica para a pessoa informar).
 */

export type Boleto = {
  kind: "BANCARIO" | "ARRECADACAO";
  /** os 44 dígitos do código de barras */
  barcode: string;
  /** linha digitável formatada */
  line: string;
  bankCode: string | null;
  amount: number | null;
  /** aaaa-mm-dd */
  dueDate: string | null;
};

export class BoletoError extends Error {}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

function mod10(num: string) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    const p = Number(num[i]) * weight;
    sum += p > 9 ? Math.floor(p / 10) + (p % 10) : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/** Módulo 11 do boleto bancário: 0, 10 e 11 viram 1. */
function mod11Bank(num: string) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação: resto 0 ou 1 dá 0, resto 10 dá 1. */
function mod11Collect(num: string) {
  let sum = 0;
  let weight = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fator de vencimento → data, escolhendo a contagem mais perto de hoje. */
export function dueDateFromFactor(factor: number, now = new Date()): string | null {
  if (!factor) return null; // 0000 = sem vencimento
  const old = new Date(Date.UTC(1997, 9, 7) + factor * DAY);
  const candidates = [old];
  if (factor >= 1000) candidates.push(new Date(Date.UTC(2025, 1, 22) + (factor - 1000) * DAY));
  candidates.sort((a, b) => Math.abs(a.getTime() - now.getTime()) - Math.abs(b.getTime() - now.getTime()));
  return iso(candidates[0]);
}

function bankFromBarcode(bc: string, now: Date): Boleto {
  if (mod11Bank(bc.slice(0, 4) + bc.slice(5)) !== Number(bc[4])) throw new BoletoError("Código de barras com dígito verificador inválido — confira os números");
  const free = bc.slice(19);
  const f1 = bc.slice(0, 4) + free.slice(0, 5);
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);
  const digits = `${f1}${mod10(f1)}${f2}${mod10(f2)}${f3}${mod10(f3)}${bc[4]}${bc.slice(5, 19)}`;
  const line = `${digits.slice(0, 5)}.${digits.slice(5, 10)} ${digits.slice(10, 15)}.${digits.slice(15, 21)} ${digits.slice(21, 26)}.${digits.slice(26, 32)} ${digits[32]} ${digits.slice(33)}`;
  const value = Number(bc.slice(9, 19)) / 100;
  return { kind: "BANCARIO", barcode: bc, line, bankCode: bc.slice(0, 3), amount: value > 0 ? value : null, dueDate: dueDateFromFactor(Number(bc.slice(5, 9)), now) };
}

function collectFromBarcode(bc: string): Boleto {
  const ref = bc[2];
  const useMod10 = ref === "6" || ref === "7";
  const check = useMod10 ? mod10 : mod11Collect;
  if (check(bc.slice(0, 3) + bc.slice(4)) !== Number(bc[3])) throw new BoletoError("Código de barras com dígito verificador inválido — confira os números");
  const blocks = [0, 11, 22, 33].map((i) => bc.slice(i, i + 11));
  const line = blocks.map((b) => `${b}-${check(b)}`).join(" ");
  const value = ref === "6" || ref === "8" ? Number(bc.slice(4, 15)) / 100 : 0;
  return { kind: "ARRECADACAO", barcode: bc, line, bankCode: null, amount: value > 0 ? value : null, dueDate: null };
}

/** Aceita a linha digitável (47/48) ou o código de barras (44), com ou sem pontos e espaços. */
export function parseBoleto(input: string, now = new Date()): Boleto {
  const d = onlyDigits(input);
  if (d.length === 44) return d[0] === "8" ? collectFromBarcode(d) : bankFromBarcode(d, now);
  if (d.length === 47) {
    const fields = [d.slice(0, 10), d.slice(10, 21), d.slice(21, 32)];
    fields.forEach((f, i) => {
      if (mod10(f.slice(0, -1)) !== Number(f.slice(-1))) throw new BoletoError(`Linha digitável com erro no ${i + 1}º campo — confira os números`);
    });
    const bc = d.slice(0, 4) + d[32] + d.slice(33) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return bankFromBarcode(bc, now);
  }
  if (d.length === 48 && d[0] === "8") {
    const blocks = [0, 12, 24, 36].map((i) => d.slice(i, i + 12));
    const useMod10 = d[2] === "6" || d[2] === "7";
    blocks.forEach((b, i) => {
      if ((useMod10 ? mod10 : mod11Collect)(b.slice(0, 11)) !== Number(b[11])) throw new BoletoError(`Linha digitável com erro no ${i + 1}º bloco — confira os números`);
    });
    return collectFromBarcode(blocks.map((b) => b.slice(0, 11)).join(""));
  }
  throw new BoletoError("Não reconheci um boleto: a linha digitável tem 47 ou 48 números e o código de barras, 44");
}

/** Procura a linha digitável num texto (PDF do boleto). */
export function findBoletoInText(text: string, now = new Date()): Boleto | null {
  const candidates = text.match(/(?:\d[\d.\s-]{42,70}\d)/g) ?? [];
  for (const c of candidates) {
    const d = onlyDigits(c);
    for (const len of [47, 48, 44]) {
      for (let i = 0; i + len <= d.length; i++) {
        try {
          return parseBoleto(d.slice(i, i + len), now);
        } catch {
          /* tenta o próximo pedaço */
        }
      }
    }
  }
  return null;
}

/** Beneficiário e CNPJ/CPF a partir do texto do boleto, quando dá para achar. */
export function beneficiaryFromText(text: string): { name: string | null; document: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => /^(benefici[aá]rio|cedente)\b/i.test(l));
  if (idx < 0) return { name: null, document: null };
  const near = lines.slice(idx, idx + 3).join(" ");
  // CNPJ formatado, só números (alguns bancos imprimem com um zero na frente: 15 dígitos) ou CPF
  // sem documento perto do nome: vale o primeiro CNPJ do boleto (o do pagador costuma ser CPF)
  const doc =
    /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14,15}(?!\d)|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}(?!\d))/.exec(near)?.[1] ?? /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.exec(text)?.[0] ?? null;
  const rest = near.replace(/^(benefici[aá]rio|cedente)[:\s]*/i, "");
  const name = rest.split(/\s[-–]\s|\s\d{2}\.?\d{3}|\s\d{11,14}|CNPJ|CPF|Nosso\s+N[uú]mero|Vencimento|Ag[eê]ncia|Pagador/i)[0].trim() || null;
  return { name: name && name.length > 2 ? name.slice(0, 120) : null, document: doc };
}

/**
 * Fatura de cartão e boleto de valor em aberto trazem valor e vencimento
 * zerados no código de barras. Nesse caso os dois saem do texto do PDF.
 */
export function amountFromText(text: string): number | null {
  const m = /\bvalor[ \t]*(?:do documento|cobrado|total)?[ \t]*:?[ \t]*(?:R\$[ \t]*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(text);
  const value = m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : 0;
  return value > 0 ? value : null;
}

export function dueDateFromText(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/vencimento/i.test(lines[i])) continue;
    // a data na mesma linha, depois da palavra; senão, na linha de baixo (cabeçalho de tabela)
    const m = /vencimento[^\d\n]{0,40}?(\d{2})\/(\d{2})\/(\d{4})/i.exec(lines[i]) ?? /(\d{2})\/(\d{2})\/(\d{4})/.exec(lines[i + 1] ?? "");
    if (!m) continue;
    const [, d, mo, y] = m;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (date.getUTCDate() === Number(d) && date.getUTCMonth() === Number(mo) - 1) return iso(date);
  }
  return null;
}

/** Uma compra de dentro da fatura de cartão. */
export type InvoiceItem = {
  /** aaaa-mm-dd */
  date: string | null;
  /** onde foi gasto (estabelecimento) */
  store: string;
  /** o lançamento como veio na fatura */
  description: string;
  /** "2/3" quando é parcela */
  installment: string | null;
  amount: number;
};

const ITEM_LINE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/;
// "Compra a Vista sem Juros Visa LOJA" / "Parcela de compra lojista Visa - Parc.1/2 LOJA"
const ITEM_PREFIX = /^(?:compra\s+(?:a\s+vista|parcelada)(?:\s+(?:sem|com)\s+juros)?|parcela\s+de\s+compra(?:\s+lojista)?)\s*(?:visa|master(?:card)?|elo|hiper(?:card)?|amex)?\s*/i;
const ITEM_PARC = /\s*-?\s*parc(?:ela)?\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*/i;

/**
 * Lançamentos de uma fatura de cartão: uma linha por compra, com a loja.
 * Vale o trecho dos lançamentos do período; o quadro de "próximas faturas"
 * fica de fora (são parcelas que ainda vão cair). Pagamento da fatura anterior
 * não é gasto e também fica de fora.
 */
export function invoiceItemsFromText(text: string): InvoiceItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const start = lines.findIndex((l) => /lan[cç]amentos/i.test(l));
  const items: InvoiceItem[] = [];
  for (let i = Math.max(0, start); i < lines.length; i++) {
    if (/pr[oó]ximas?\s+faturas?/i.test(lines[i]) && items.length) break;
    const m = ITEM_LINE.exec(lines[i]);
    if (!m) continue;
    const [, d, mo, y, raw, val] = m;
    const description = raw.replace(/\s+/g, " ").trim();
    if (/^pagamento\b/i.test(description)) continue;
    const parc = ITEM_PARC.exec(description);
    const store =
      description
        .replace(ITEM_PREFIX, "")
        .replace(ITEM_PARC, " ")
        // "DL"/"PG" na frente é só a marca do intermediador de pagamento
        .replace(/^(?:DL|PG)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim() || description;
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    items.push({
      date: date.getUTCDate() === Number(d) ? iso(date) : null,
      store: store.slice(0, 160),
      description: description.slice(0, 300),
      installment: parc ? `${Number(parc[1])}/${Number(parc[2])}` : null,
      amount: Number(val.replace(/\./g, "").replace(",", ".")),
    });
  }
  return items;
}

/** Total por loja, do maior para o menor. */
export function invoiceTotalsByStore(items: { store: string; amount: number }[]): { store: string; count: number; total: number }[] {
  const map = new Map<string, { store: string; count: number; total: number }>();
  for (const it of items) {
    const key = it.store.toUpperCase();
    const cur = map.get(key) ?? { store: it.store, count: 0, total: 0 };
    cur.count += 1;
    cur.total = Math.round((cur.total + it.amount) * 100) / 100;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
