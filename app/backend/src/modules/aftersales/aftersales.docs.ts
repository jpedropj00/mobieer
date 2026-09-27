/**
 * §37/§38 — Relatório de vistoria e certificado de garantia. Builders puros
 * (dados in, texto out), no mesmo gerador de PDF do contrato e do recibo.
 * Dado que não existe vira "não informado" — nunca é inventado.
 */
import type { InspectionItemStatus, SiteInspectionResult } from "@prisma/client";
import { fmtDate, type BuiltDocument } from "../docgen/docgen.service";
import { ITEM_STATUS_SHORT, RESULT_LABEL, WARRANTY_CONDITIONS, WARRANTY_EXCLUSIONS, type CoverageItem } from "./aftersales.rules";

const years = (months: number) => (months % 12 === 0 ? `${months / 12} ${months === 12 ? "ano" : "anos"}` : `${months} meses`);
/** Relatório e certificado vão para o cliente: dado ausente é só "não informado". */
const ci = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "não informado");

export type InspectionReportData = {
  company: string;
  client: { name: string; document: string | null; address: string | null };
  project: { code: string; name: string };
  inspectedAt: Date;
  ambientes: string | null;
  technician: string | null;
  installers: string | null;
  items: { section: string; label: string; status: InspectionItemStatus | null; note: string | null }[];
  result: SiteInspectionResult;
  pendencias: string | null;
  notes: string | null;
  clientSignerName: string | null;
  signedByClient: boolean;
  signedByTechnician: boolean;
  photoCount: number;
  issuedAt: Date;
};

export function buildInspectionReport(d: InspectionReportData): BuiltDocument {
  const lines: string[] = [
    "DADOS DA OBRA",
    `Cliente: ${d.client.name}${d.client.document ? ` — ${d.client.document}` : ""}`,
    `Nº do contrato: ${d.project.code} — ${d.project.name}`,
    `Endereço: ${ci(d.client.address)}`,
    `Técnico responsável: ${ci(d.technician)}`,
    `Montadci(es): ${ci(d.installers)}`,
    `Data da vistoria: ${fmtDate(d.inspectedAt)}`,
    `Ambiente(s): ${ci(d.ambientes)}`,
    "",
    "LEGENDA: C = Conforme · NC = Não conforme · NA = Não se aplica",
  ];
  let section = "";
  for (const i of d.items) {
    if (i.section !== section) {
      section = i.section;
      lines.push("", section.toUpperCase());
    }
    lines.push(`[${i.status ? ITEM_STATUS_SHORT[i.status] : " "}] ${i.label}${i.note ? ` — ${i.note}` : ""}`);
  }
  const nc = d.items.filter((i) => i.status === "NAO_CONFORME").length;
  lines.push(
    "",
    "RESULTADO DA VISTORIA",
    RESULT_LABEL[d.result],
    `Itens não conformes: ${nc} de ${d.items.length}`,
    `Fotos anexadas no sistema: ${d.photoCount}`,
    "",
    "PENDÊNCIAS",
    d.pendencias?.trim() || "Nenhuma pendência registrada.",
    ...(d.notes?.trim() ? ["", "OBSERVAÇÕES", d.notes.trim()] : []),
    "",
    "TERMO DE ENTREGA",
    `Declaro que realizei a vistoria técnica do mobiliário planejado instalado pela ${d.company}, conforme os itens registrados neste checklist.`,
    "",
    `Técnico responsável: ${ci(d.technician)} — ${d.signedByTechnician ? "assinado eletronicamente no sistema" : "sem assinatura registrada"}`,
    `Cliente: ${ci(d.clientSignerName ?? d.client.name)} — ${d.signedByClient ? "assinado eletronicamente no sistema" : "sem assinatura registrada"}`,
    `Data: ${fmtDate(d.issuedAt)}`
  );
  return {
    title: "Checklist de vistoria técnica de montagem",
    body: lines.join("\n"),
    footer: `Relatório gerado pelo sistema em ${fmtDate(d.issuedAt)}.`,
  };
}

export type CertificateData = {
  company: string;
  client: { name: string; document: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; zipCode: string | null };
  project: { code: string; name: string };
  designer: string | null;
  consultant: string | null;
  installers: string | null;
  purchaseDate: Date | null;
  deliveryDate: Date | null;
  inspectionDate: Date;
  ambientes: string | null;
  coverage: CoverageItem[];
  issuedAt: Date;
};

export function buildWarrantyCertificate(d: CertificateData): BuiltDocument {
  const body = [
    "DADOS DO CLIENTE",
    `Cliente: ${d.client.name}`,
    `CPF / CNPJ: ${ci(d.client.document)}`,
    `Telefone: ${ci(d.client.phone)}`,
    `E-mail: ${ci(d.client.email)}`,
    `Endereço: ${ci(d.client.address)}`,
    `Cidade / UF: ${ci(d.client.city)}`,
    `CEP: ${ci(d.client.zipCode)}`,
    "",
    "DADOS DO PROJETO",
    `Nº do contrato: ${d.project.code} — ${d.project.name}`,
    `Projetista: ${ci(d.designer)}`,
    `Consultci(a): ${ci(d.consultant)}`,
    `Montadci(es): ${ci(d.installers)}`,
    `Data da compra: ${d.purchaseDate ? fmtDate(d.purchaseDate) : "não informada"}`,
    `Data da entrega: ${d.deliveryDate ? fmtDate(d.deliveryDate) : "não informada"}`,
    `Data da vistoria final: ${fmtDate(d.inspectionDate)}`,
    `Ambientes entregues: ${ci(d.ambientes)}`,
    "",
    "PRAZOS DE GARANTIA",
    ...d.coverage.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}: ${years(c.months)} — até ${fmtDate(new Date(c.endsAt))}`),
    "",
    "CONDIÇÕES",
    WARRANTY_CONDITIONS,
    "",
    "A GARANTIA NÃO COBRE",
    ...WARRANTY_EXCLUSIONS.split("\n").map((l) => `• ${l}`),
    "",
    "DECLARAÇÃO",
    "Declaro que recebi os móveis planejados instalados conforme contratado, juntamente com o Manual de Uso e Conservação, estando ciente das orientações de utilização, manutenção e das condições de garantia aqui descritas.",
    "",
    `${d.company} — Fortaleza, ${fmtDate(d.issuedAt)}.`,
  ].join("\n");
  return { title: "Certificado de garantia", body, footer: `Certificado gerado pelo sistema em ${fmtDate(d.issuedAt)}.` };
}
