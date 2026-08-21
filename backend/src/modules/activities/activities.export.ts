import type { Response } from "express";
import PDFDocument from "pdfkit";

const status: Record<string, string> = { DRAFT: "Rascunho", IN_PROGRESS: "Em andamento", COMPLETED: "Concluído", CANCELLED: "Cancelado" };
export function activityPdf(res: Response, activity: any) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${activity.number}.pdf"`); doc.pipe(res);
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#16181d").text("Gestium", { continued: true }).fillColor("#f59e0b").text("  Relatório de Atividade");
  doc.moveDown(.4).font("Helvetica").fontSize(9).fillColor("#6b7280").text(`${activity.number} • ${new Date(activity.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })} • ${status[activity.status]}`);
  doc.moveTo(42, doc.y + 8).lineTo(553, doc.y + 8).strokeColor("#e5e7eb").stroke(); doc.moveDown(1.4);
  const field = (label: string, value?: string | null) => { if (!value) return; doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(label); doc.font("Helvetica").fontSize(10).fillColor("#111827").text(value); doc.moveDown(.45); };
  field("Funcionário", activity.employee.name); field("Setor", activity.sector); field("Horário", [activity.startTime, activity.endTime].filter(Boolean).join(" às ")); field("Cliente / Projeto", [activity.clientName, activity.projectReference].filter(Boolean).join(" • ")); field("Serviço realizado", activity.service); field("Descrição", activity.description); field("Problemas encontrados", activity.problemsSummary);
  if (activity.materials.length) { doc.moveDown().font("Helvetica-Bold").fontSize(12).text("Materiais utilizados"); activity.materials.forEach((m: any) => doc.font("Helvetica").fontSize(9).text(`• ${m.name}: ${m.quantity} ${m.unit}${m.note ? ` — ${m.note}` : ""}`)); }
  if (activity.problems.length) { doc.moveDown().font("Helvetica-Bold").fontSize(12).text("Problemas registrados"); activity.problems.forEach((p: any) => doc.font("Helvetica").fontSize(9).text(`• [${p.priority}] ${p.description}${p.note ? ` — ${p.note}` : ""}`)); }
  field("Observações", activity.observations);
  if (activity.signatures.length) { doc.moveDown().font("Helvetica-Bold").fontSize(12).text("Assinaturas"); activity.signatures.forEach((s: any) => { doc.font("Helvetica").fontSize(9).text(`${s.role}: ${s.signerName} — ${new Date(s.signedAt).toLocaleString("pt-BR")}`); try { doc.image(s.dataUrl, { fit: [140, 45] }); } catch {} }); }
  doc.moveDown(2).font("Helvetica").fontSize(8).fillColor("#9ca3af").text(`Documento gerado em ${new Date().toLocaleString("pt-BR")} • Gestium — Gestão inteligente`, { align: "center" }); doc.end(); return res;
}
