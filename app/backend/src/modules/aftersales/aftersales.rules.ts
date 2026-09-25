/**
 * §35/§36/§37/§38 — Regras puras do pós-venda: o checklist de vistoria, a
 * coerência do resultado, os prazos de garantia por componente, os avisos de
 * fim de garantia e o calendário de manutenção preventiva.
 *
 * O checklist e os prazos vêm dos documentos reais da Mobieer
 * (docs/Checklist_Vistoria_Tecnica_Mobieer.pdf e docs/CERTIFICADO GARANTIA.pptx).
 */
import type { InspectionItemStatus, SiteInspectionResult } from "@prisma/client";

// ============================================================
// Vistoria
// ============================================================

export const INSPECTION_CHECKLIST: { section: string; items: string[] }[] = [
  {
    section: "Estrutura",
    items: [
      "Fixação das caixas (mínimo 4 pontos)",
      "Fixação dos painéis",
      "Fixação das prateleiras",
      "Fechamentos laterais",
      "Rodateto",
      "Rodapé",
      "Alinhamento dos tamponamentos",
    ],
  },
  {
    section: "Ferragens",
    items: [
      "Dobradiças com 4 parafusos",
      "Funcionamento das dobradiças",
      "Funcionamento das corrediças",
      "Funcionamento dos aramados",
      "Funcionamento dos pistões",
      "Instalação dos puxadores",
    ],
  },
  { section: "Alinhamento", items: ["Portas alinhadas", "Gavetas alinhadas", "Folgas uniformes", "Nivelamento geral do mobiliário"] },
  {
    section: "Acabamento",
    items: [
      "Fitas de borda sem avarias",
      "Tapa-furos na cor correta",
      "Sem lascas ou riscos aparentes",
      "Junções bem acabadas",
      "Silicone com acabamento adequado",
      "Sem excesso de cola",
    ],
  },
  { section: "Portas deslizantes", items: ["Deslizamento suave", "Guia inferior instalada", "Batentes instalados", "Alinhamento"] },
  { section: "Portas de giro", items: ["Abertura adequada", "Fechamento correto", "Batentes instalados", "Esquadro"] },
  { section: "Portas pivotantes", items: ["Alinhamento do pivô", "Abertura", "Fechamento", "Batentes"] },
  {
    section: "Limpeza final",
    items: [
      "Limpeza geral do móvel",
      "Limpeza em áreas não visíveis",
      "Remoção de etiquetas",
      "Remoção de marcações de lápis",
      "Remoção de resíduos de cola",
      "Remoção de silicone excedente",
      "Ambiente entregue limpo",
    ],
  },
  {
    section: "Itens complementares",
    items: [
      "Conferência das medidas finais",
      "Conferência da paginação dos veios do MDF",
      "Integridade dos vidros",
      "Integridade dos espelhos",
      "Funcionamento da iluminação LED",
      "Proteção do piso e paredes removida",
      "Fotos finais da montagem realizadas",
    ],
  },
];

/** Linhas iniciais do checklist, na ordem do papel. */
export function checklistRows() {
  let position = 0;
  return INSPECTION_CHECKLIST.flatMap((s) => s.items.map((label) => ({ section: s.section, label, position: position++ })));
}

export const RESULT_LABEL: Record<SiteInspectionResult, string> = {
  APPROVED: "Entrega aprovada sem ressalvas",
  APPROVED_WITH_REMARKS: "Entrega aprovada com ressalvas",
  REJECTED: "Entrega não aprovada",
};

export const ITEM_STATUS_SHORT: Record<InspectionItemStatus, string> = { CONFORME: "C", NAO_CONFORME: "NC", NAO_APLICA: "NA" };

/**
 * Pode concluir a vistoria com este resultado? Exige todos os itens marcados,
 * não deixa "aprovada sem ressalvas" com item não conforme e exige as
 * pendências escritas quando há ressalva ou reprovação.
 */
export function canComplete(
  items: { section: string; label: string; status: InspectionItemStatus | null }[],
  result: SiteInspectionResult,
  pendencias: string | null | undefined
): { ok: true } | { ok: false; motivo: string } {
  const vazios = items.filter((i) => !i.status);
  if (vazios.length) {
    const ex = vazios.slice(0, 3).map((i) => `${i.section}: ${i.label}`).join("; ");
    return { ok: false, motivo: `${vazios.length} item(ns) sem marcação (${ex}${vazios.length > 3 ? "…" : ""})` };
  }
  const nc = items.filter((i) => i.status === "NAO_CONFORME");
  if (result === "APPROVED" && nc.length) {
    return { ok: false, motivo: `Há ${nc.length} item(ns) não conforme(s): registre como "aprovada com ressalvas" ou "não aprovada"` };
  }
  if (result !== "APPROVED" && !(pendencias && pendencias.trim().length >= 3)) {
    return { ok: false, motivo: "Descreva as pendências da vistoria" };
  }
  return { ok: true };
}

/** Vistoria que libera a garantia: aprovada, com ou sem ressalvas. */
export const releasesWarranty = (r: SiteInspectionResult) => r === "APPROVED" || r === "APPROVED_WITH_REMARKS";

// ============================================================
// Garantia
// ============================================================

export const WARRANTY_COMPONENTS: { key: string; label: string; detail?: string; months: number }[] = [
  { key: "estrutura", label: "Estrutura e montagem", months: 60 },
  { key: "ferragens", label: "Ferragens", detail: "dobradiças, corrediças, roldanas, pistões", months: 60 },
  { key: "puxadores", label: "Puxadores", months: 24 },
  { key: "aramados", label: "Aramados", detail: "porta-objetos, porta-pano, cabideiros etc.", months: 12 },
];

export const WARRANTY_CONDITIONS =
  "A Mobieer Planejados oferece garantia contra defeitos de fabricação e montagem, conforme os prazos por componente deste certificado, contados da data da vistoria final. Para acionar a garantia, entre em contato com a Mobieer para agendamento prévio da assistência técnica.";

export const WARRANTY_EXCLUSIONS = [
  "Mau uso, negligência e uso inadequado",
  "Impactos, quedas e acidentes",
  "Água, infiltrações e excesso de umidade",
  "Cupins e pragas de madeira",
  "Produtos químicos inadequados ou abrasivos",
  "Alterações ou reparos realizados por terceiros",
  "Desgaste natural do uso",
  "Produtos fornecidos por terceiros (vidros, espelhos, metalon, estofados etc.)",
].join("\n");

/** Soma meses sem estourar o fim do mês (31/01 + 1 mês = 28 ou 29/02). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + months);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
}

export type CoverageItem = { key: string; label: string; detail?: string; months: number; endsAt: string };

export function buildCoverage(start: Date, components = WARRANTY_COMPONENTS): { coverage: CoverageItem[]; endsAt: Date } {
  const coverage = components.map((c) => ({ ...c, endsAt: addMonths(start, c.months).toISOString() }));
  const endsAt = new Date(Math.max(...coverage.map((c) => new Date(c.endsAt).getTime())));
  return { coverage, endsAt };
}

export const WARRANTY_ALERT_DAYS = 30;

/**
 * Avisos de fim de garantia que cabem hoje: um por componente, quando faltam
 * até 30 dias e ainda não venceu, e só uma vez (chave `<componente>:30d`).
 */
export function warrantyAlertsDue(coverage: CoverageItem[], sent: string[], now: Date) {
  const DAY = 86_400_000;
  return coverage
    .map((c) => ({ c, days: Math.ceil((new Date(c.endsAt).getTime() - now.getTime()) / DAY), key: `${c.key}:${WARRANTY_ALERT_DAYS}d` }))
    .filter((x) => x.days >= 0 && x.days <= WARRANTY_ALERT_DAYS && !sent.includes(x.key));
}

/** Situação de cada componente para mostrar (vigente / vence em breve / encerrada). */
export function coverageState(c: CoverageItem, now: Date) {
  const days = Math.ceil((new Date(c.endsAt).getTime() - now.getTime()) / 86_400_000);
  return { ...c, daysLeft: days, state: days < 0 ? ("EXPIRED" as const) : days <= WARRANTY_ALERT_DAYS ? ("EXPIRING" as const) : ("ACTIVE" as const) };
}

// ============================================================
// Manutenção preventiva
// ============================================================

export const DEFAULT_MAINTENANCE_MONTHS = [6, 12];

/** Configuração salva: lista de meses (1–120), sem repetição, em ordem. */
export function parseMaintenanceMonths(raw: string | null | undefined): number[] {
  if (!raw) return DEFAULT_MAINTENANCE_MONTHS;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_MAINTENANCE_MONTHS;
    const ok = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 120))].sort((a, b) => a - b);
    return ok;
  } catch {
    return DEFAULT_MAINTENANCE_MONTHS;
  }
}

export function maintenanceSchedule(start: Date, months: number[]) {
  return months.map((m) => ({ monthsAfter: m, label: `Revisão preventiva de ${m} ${m === 1 ? "mês" : "meses"}`, dueAt: addMonths(start, m) }));
}

export const MAINTENANCE_REMIND_DAYS = 7;

/** Lembra uma vez, a partir de 7 dias antes da data (inclusive se já passou e ninguém foi avisado). */
export function maintenanceNeedsReminder(m: { status: string; dueAt: Date; remindedAt: Date | null }, now: Date) {
  if (m.status !== "SCHEDULED" || m.remindedAt) return false;
  return m.dueAt.getTime() - now.getTime() <= MAINTENANCE_REMIND_DAYS * 86_400_000;
}
