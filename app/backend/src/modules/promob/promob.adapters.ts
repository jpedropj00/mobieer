/**
 * §19 — Camada de integração com o Promob. O resto do sistema só conhece
 * `readPromobFile` e o formato `PromobParsed`; cada forma de entrada é um
 * adapter. Hoje: XML de orçamento, CSV de plano de corte/peças e PDF (só
 * armazenado). A entrada por plugin/sincronizador já existe (source=SYNC, em
 * /api/integrations) e passa pelo mesmo `readPromobFile`. Uma API do Promob,
 * se um dia existir, entra como mais um adapter sem tocar em quem consome.
 */
import { parsePromobCsv, type CsvResult } from "./promob.csv";
import { decodeXmlBuffer, parsePromobXml, type PromobParsed } from "./promob.service";

export type PromobFormat = "XML" | "CSV" | "PDF" | "OTHER";

export type PromobRead = {
  format: PromobFormat;
  status: "PARSED" | "PARSE_FAILED" | "UPLOADED";
  itemCount: number;
  totalValue: number | null;
  parsed: (PromobParsed & Partial<Pick<CsvResult, "pecas" | "materiais" | "columns" | "warnings">>) | null;
  notes: string | null;
};

type Adapter = {
  format: PromobFormat;
  accepts: (fileName: string, mime: string) => boolean;
  read: (buf: Buffer) => PromobRead;
};

const ADAPTERS: Adapter[] = [
  {
    format: "XML",
    accepts: (f, m) => /\.xml$/i.test(f) || m.includes("xml"),
    read: (buf) => {
      const p = parsePromobXml(decodeXmlBuffer(buf));
      const okRead = p.totals.itens > 0 || p.totals.ambientes > 0;
      return {
        format: "XML",
        status: okRead ? "PARSED" : "PARSE_FAILED",
        itemCount: p.totals.itens,
        totalValue: p.totals.valor ?? null,
        parsed: p,
        notes: okRead ? null : "XML lido, mas nenhum <ITEM>/<AMBIENTE> reconhecido nesta versão de export.",
      };
    },
  },
  {
    format: "CSV",
    accepts: (f, m) => /\.(csv|tsv)$/i.test(f) || m.includes("csv"),
    read: (buf) => {
      const p = parsePromobCsv(buf);
      return {
        format: "CSV",
        status: p.pecas.length ? "PARSED" : "PARSE_FAILED",
        itemCount: p.pecas.length,
        totalValue: p.totals.valor ?? null,
        parsed: p,
        notes: p.warnings.length ? p.warnings.join(" ") : null,
      };
    },
  },
  {
    format: "PDF",
    accepts: (f, m) => /\.pdf$/i.test(f) || m.includes("pdf"),
    read: () => ({
      format: "PDF",
      status: "UPLOADED",
      itemCount: 0,
      totalValue: null,
      parsed: null,
      notes: "PDF armazenado. A extração automática é feita no XML de orçamento e no CSV de plano de corte.",
    }),
  },
];

export function detectPromobFormat(fileName: string, mime: string): PromobFormat {
  return ADAPTERS.find((a) => a.accepts(fileName, mime))?.format ?? "OTHER";
}

/** Lê o arquivo pelo adapter do formato. Nunca lança: erro de leitura vira PARSE_FAILED com o motivo. */
export function readPromobFile(file: { buffer: Buffer; originalname: string; mimetype: string }): PromobRead {
  const adapter = ADAPTERS.find((a) => a.accepts(file.originalname, file.mimetype || ""));
  if (!adapter) {
    return { format: "OTHER", status: "UPLOADED", itemCount: 0, totalValue: null, parsed: null, notes: "Formato não reconhecido — arquivo armazenado para conferência manual." };
  }
  try {
    return adapter.read(file.buffer);
  } catch (e) {
    return {
      format: adapter.format,
      status: "PARSE_FAILED",
      itemCount: 0,
      totalValue: null,
      parsed: null,
      notes: `Falha ao ler o ${adapter.format}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
