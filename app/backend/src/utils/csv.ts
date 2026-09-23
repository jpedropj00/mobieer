/**
 * Exportação CSV (§59).
 *
 * Um gerador só para todas as telas, em vez de montar string em cada rota.
 *
 * O alvo é o Excel em português, e isso manda no formato:
 * - separador `;`, porque o Excel pt-BR usa vírgula como decimal e quebraria
 *   as colunas num CSV separado por vírgula;
 * - BOM UTF-8 no início, senão o Excel abre "Produção" como "ProduÃ§Ã£o";
 * - CRLF entre as linhas, que é o que o RFC 4180 pede.
 */

export type CsvColumn<T> = {
  /** Cabeçalho que aparece na primeira linha. */
  header: string;
  /** Valor da célula. Devolver null/undefined vira célula vazia. */
  value: (row: T) => string | number | Date | null | undefined;
};

const SEP = ";";
const EOL = "\r\n";
export const CSV_BOM = "﻿";

/**
 * Escapa uma célula. Além das aspas e do separador, cuida de dois casos que
 * costumam passar despercebidos:
 *
 * 1. Fórmula: uma célula começando com = + - @ é executada pelo Excel ao abrir
 *    ("CSV injection"). Prefixar com aspa simples neutraliza sem perder o texto.
 * 2. Quebra de linha dentro do valor (descrição, observação): precisa ficar
 *    entre aspas, senão vira uma linha nova no arquivo.
 */
export function csvCell(v: string | number | Date | null | undefined): string {
  if (v == null) return "";

  if (v instanceof Date) {
    // data e hora no fuso da loja, no formato que o Excel pt-BR entende
    return v.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });
  }

  if (typeof v === "number") {
    // decimal com vírgula: no Excel pt-BR "1.250.50" não é número
    return String(v).replace(".", ",");
  }

  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  if (s.includes('"') || s.includes(SEP) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Monta o CSV inteiro, com BOM e cabeçalho. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const cabecalho = columns.map((c) => csvCell(c.header)).join(SEP);
  const corpo = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(SEP));
  return CSV_BOM + [cabecalho, ...corpo].join(EOL) + EOL;
}

/**
 * Nome de arquivo seguro: sem caminho, sem caractere que quebre o
 * Content-Disposition, e sempre com a data para não sobrescrever o anterior.
 */
export function csvFileName(base: string, agora = new Date()): string {
  const dia = agora.toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
  const limpo = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${limpo || "export"}-${dia}.csv`;
}
