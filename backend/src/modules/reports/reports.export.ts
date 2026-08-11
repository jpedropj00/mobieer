import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const HEADER_LABELS: Record<string, string> = {
  id: "ID",
  name: "Nome",
  code: "Código",
  sku: "SKU",
  unit: "Unidade",
  stock: "Estoque",
  minStock: "Mín.",
  maxStock: "Máx.",
  deficit: "Déficit",
  unitValue: "Valor unit.",
  quantity: "Qtd.",
  date: "Data",
  type: "Tipo",
  note: "Observação",
  invoiceNumber: "NF",
  batch: "Lote",
  requesterName: "Solicitante",
  sector: "Setor",
  destination: "Destino",
  reason: "Motivo",
  category: "Categoria",
  supplier: "Fornecedor",
  responsible: "Responsável",
  requisition: "Requisição",
  product: "Produto",
  productId: "Produto ID",
  warehouse: "Almoxarifado",
  location: "Localização",
  status: "Status",
  startedBy: "Iniciado por",
  itemCount: "Itens",
  createdAt: "Criado em",
  concludedAt: "Concluído em",
  deficit_t: "Déficit",
  employee: "Funcionário",
  lastMovement: "Últ. mov.",
  quantity_t: "Quantidade",
  requisitionId: "Requis. ID",
};

function rowToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return value.toLocaleString("pt-BR");
    const v = value as Record<string, unknown>;
    return v.name ? String(v.name) : JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const cols = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => cols.add(k)));
  return [...cols];
}

export function exportCsv(res: Response, data: unknown[], filename: string): Response {
  const rows = data as Record<string, unknown>[];
  const cols = collectColumns(rows);
  const escape = (v: string) => (v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    cols.map((c) => escape(HEADER_LABELS[c] ?? c)).join(","),
    ...rows.map((r) => cols.map((c) => escape(rowToString(r[c]))).join(",")),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.status(200).send("\uFEFF" + lines.join("\n"));
  return res;
}

export async function exportXlsx(res: Response, data: unknown[], filename: string): Promise<Response> {
  const rows = data as Record<string, unknown>[];
  const cols = collectColumns(rows);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Relatório");
  sheet.columns = cols.map((c) => ({
    header: HEADER_LABELS[c] ?? c,
    key: c,
    width: Math.max(12, Math.min(40, (HEADER_LABELS[c] ?? c).length + 10)),
  }));
  rows.forEach((r) =>
    sheet.addRow(Object.fromEntries(cols.map((c) => [c, rowToString(r[c])])))
  );
  sheet.getRow(1).font = { bold: true };
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
  return res;
}

const PDF_PAGE_WIDTH = 595.28;
const PDF_MARGIN = 30;
const FONT = "Helvetica";

export function exportPdf(res: Response, data: unknown[], filename: string, type: string): Response {
  const rows = data as Record<string, unknown>[];
  const cols = collectColumns(rows).slice(0, 6);
  const doc = new PDFDocument({ size: "A4", margin: PDF_MARGIN, bufferPages: true });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  doc.font(FONT).fontSize(16).text("MOBIEER — Relatório de Almoxarifado", { align: "center" });
  doc.fontSize(10).text(`Tipo: ${type}  |  Gerado em: ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
  doc.moveDown();

  const tableWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const colWidth = tableWidth / cols.length;
  let y = doc.y + 6;

  const drawRow = (values: string[], bold: boolean) => {
    doc.font(FONT).fontSize(8);
    const cellPadding = 4;
    const maxHeight = 40;
    doc.y = y;
    let rowHeight = 14;
    const chunks: string[] = cols.map((_, i) => values[i] ?? "");
    const lineCounts = chunks.map((c) => {
      const lines = doc.heightOfString(c, { width: colWidth - 8 });
      return Math.max(1, Math.ceil(lines / (8 * 1.2)));
    });
    rowHeight = Math.min(maxHeight, Math.max(14, Math.max(...lineCounts) * 10));
    if (y + rowHeight > 792 - PDF_MARGIN) {
      doc.addPage();
      y = doc.y = PDF_MARGIN;
      doc.font(FONT).fontSize(8);
    }
    chunks.forEach((c, i) => {
      const x = PDF_MARGIN + i * colWidth;
      doc.rect(x, y, colWidth, rowHeight).stroke("#d1d5db");
      doc.text(c, x + 4, y + 4, { width: colWidth - 8, height: rowHeight - 8 });
    });
    if (bold) doc.font(FONT).fontSize(8);
    y += rowHeight;
  };

  drawRow(cols.map((c) => HEADER_LABELS[c] ?? c), true);
  rows.forEach((r) => drawRow(cols.map((c) => rowToString(r[c])), false));

  doc.end();
  return res;
}
