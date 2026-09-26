/**
 * §35/§36/§37/§38 — Pós-venda com banco: conclusão da vistoria (relatório em
 * PDF, garantia, certificado e revisões preventivas numa passada só) e as
 * rotinas diárias de aviso.
 */
import type { Prisma, SiteInspectionResult } from "@prisma/client";
import { prisma } from "../../prisma";
import { sendAutomation } from "../../lib/automations";
import { notifyUsersWithPermission } from "../../lib/notify";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { storeGeneratedPdf } from "../docgen/docgen.service";
import { ROOM_LABEL } from "../contractors/productivity.service";
import { buildInspectionReport, buildWarrantyCertificate } from "./aftersales.docs";
import {
  WARRANTY_CONDITIONS,
  WARRANTY_EXCLUSIONS,
  buildCoverage,
  canComplete,
  maintenanceNeedsReminder,
  maintenanceSchedule,
  parseMaintenanceMonths,
  releasesWarranty,
  warrantyAlertsDue,
  type CoverageItem,
} from "./aftersales.rules";

export const MAINTENANCE_MONTHS_SETTING = "aftersales.maintenanceMonths";

export async function loadMaintenanceMonths() {
  const row = await prisma.setting.findUnique({ where: { key: MAINTENANCE_MONTHS_SETTING } });
  return parseMaintenanceMonths(row?.value);
}

/** Dados do projeto usados pelo relatório e pelo certificado. */
async function projectContext(projectId: string) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      code: true,
      name: true,
      organizationId: true,
      organization: { select: { name: true, enterprise: { select: { tradeName: true, legalName: true } } } },
      client: {
        select: {
          id: true, name: true, document: true, phone: true, email: true,
          street: true, addressNumber: true, district: true, city: true, state: true, zipCode: true,
          seller: { select: { name: true } },
        },
      },
      productionOrder: { select: { deliveredAt: true } },
      salesOrders: { orderBy: { orderedAt: "asc" }, take: 1, select: { orderedAt: true } },
      installationTasks: { where: { status: { not: "CANCELLED" } }, select: { roomLabel: true, roomType: true, contractor: { select: { name: true } } } },
    },
  });
  const c = p.client;
  const address = [c.street && `${c.street}${c.addressNumber ? `, ${c.addressNumber}` : ""}`, c.district].filter(Boolean).join(" — ") || null;
  const installers = [...new Set(p.installationTasks.map((t) => t.contractor.name))].join(", ") || null;
  const rooms = [...new Set(p.installationTasks.map((t) => t.roomLabel || ROOM_LABEL[t.roomType]))].join(", ") || null;
  return {
    p,
    company: p.organization.enterprise.tradeName || p.organization.enterprise.legalName || p.organization.name,
    address,
    installers,
    rooms,
  };
}

/**
 * Conclui a vistoria. Grava resultado e assinaturas, gera o relatório em PDF
 * (visível ao cliente) e, se a entrega foi aprovada, abre a garantia com o
 * certificado e agenda as revisões preventivas. Idempotência: vistoria já
 * concluída não conclui de novo; projeto com garantia não ganha outra.
 */
export async function completeInspection(opts: {
  inspectionId: string;
  organizationId: string;
  actorId: string;
  result: SiteInspectionResult;
  pendencias?: string | null;
  notes?: string | null;
  clientSignerName?: string | null;
  clientSignature?: string | null;
  technicianSignature?: string | null;
}) {
  const insp = await prisma.siteInspection.findFirst({
    where: { id: opts.inspectionId, organizationId: opts.organizationId },
    include: { items: { orderBy: { position: "asc" } }, technician: { select: { name: true } } },
  });
  if (!insp) throw new NotFoundError("Vistoria não encontrada");
  if (insp.status === "COMPLETED") throw new BadRequestError("Esta vistoria já foi concluída");
  const pendencias = opts.pendencias ?? insp.pendencias;
  const chk = canComplete(insp.items, opts.result, pendencias);
  if (!chk.ok) throw new BadRequestError(chk.motivo);

  const now = new Date();
  const ctx = await projectContext(insp.projectId);
  const photoCount = await prisma.fileRecord.count({ where: { entity: "SiteInspection", entityId: insp.id } });

  const report = await storeGeneratedPdf({
    organizationId: opts.organizationId,
    clientId: ctx.p.client.id,
    projectId: ctx.p.id,
    type: "VISTORIA_CHECKLIST",
    generatedFrom: `SiteInspection:${insp.id}`,
    title: `Vistoria técnica — ${ctx.p.code}`,
    fileName: `vistoria-${ctx.p.code}-${now.toISOString().slice(0, 10)}.pdf`,
    built: buildInspectionReport({
      company: ctx.company,
      client: { name: ctx.p.client.name, document: ctx.p.client.document, address: ctx.address },
      project: { code: ctx.p.code, name: ctx.p.name },
      inspectedAt: insp.inspectedAt,
      ambientes: insp.ambientes ?? ctx.rooms,
      technician: insp.technician?.name ?? null,
      installers: insp.installerNames ?? ctx.installers,
      items: insp.items,
      result: opts.result,
      pendencias,
      notes: opts.notes ?? insp.notes,
      clientSignerName: opts.clientSignerName ?? null,
      signedByClient: !!opts.clientSignature,
      signedByTechnician: !!opts.technicianSignature,
      photoCount,
      issuedAt: now,
    }),
    visibleToClient: true,
    uploadedById: opts.actorId,
  });

  await prisma.siteInspection.update({
    where: { id: insp.id },
    data: {
      status: "COMPLETED",
      result: opts.result,
      pendencias,
      notes: opts.notes ?? insp.notes,
      clientSignerName: opts.clientSignerName ?? null,
      clientSignature: opts.clientSignature ?? null,
      technicianSignature: opts.technicianSignature ?? null,
      completedAt: now,
      completedById: opts.actorId,
      reportDocumentId: report.id,
    },
  });
  await prisma.auditLog.create({
    data: { userId: opts.actorId, action: "INSPECTION_COMPLETED", entity: "SiteInspection", entityId: insp.id, details: { project: ctx.p.code, result: opts.result, reportId: report.id } },
  });

  let warrantyId: string | null = null;
  if (releasesWarranty(opts.result)) {
    const existing = await prisma.warranty.findUnique({ where: { projectId: insp.projectId }, select: { id: true } });
    warrantyId = existing?.id ?? (await openWarranty(insp.projectId, insp.id, insp.inspectedAt, opts.actorId)).id;
  }
  return { reportId: report.id, warrantyId };
}

/** Abre a garantia, gera o certificado e agenda as revisões preventivas. */
export async function openWarranty(projectId: string, inspectionId: string | null, start: Date, actorId: string) {
  const ctx = await projectContext(projectId);
  const { coverage, endsAt } = buildCoverage(start);
  const warranty = await prisma.warranty.create({
    data: {
      organizationId: ctx.p.organizationId,
      projectId,
      inspectionId,
      startsAt: start,
      endsAt,
      coverage: coverage as unknown as Prisma.InputJsonValue,
      conditions: WARRANTY_CONDITIONS,
      exclusions: WARRANTY_EXCLUSIONS,
      createdById: actorId,
    },
  });
  await issueCertificate(warranty.id, actorId);

  const months = await loadMaintenanceMonths();
  if (months.length) {
    await prisma.preventiveMaintenance.createMany({
      data: maintenanceSchedule(start, months).map((m) => ({
        organizationId: ctx.p.organizationId,
        projectId,
        warrantyId: warranty.id,
        label: m.label,
        monthsAfter: m.monthsAfter,
        dueAt: m.dueAt,
      })),
    });
  }
  await prisma.auditLog.create({
    data: { userId: actorId, action: "WARRANTY_OPENED", entity: "Warranty", entityId: warranty.id, details: { project: ctx.p.code, endsAt, maintenances: months } },
  });
  return warranty;
}

/** (Re)gera o certificado. Nova versão do documento, a anterior fica no histórico. */
export async function issueCertificate(warrantyId: string, actorId: string | null) {
  const w = await prisma.warranty.findUnique({ where: { id: warrantyId }, include: { inspection: { select: { ambientes: true, installerNames: true } } } });
  if (!w) throw new NotFoundError("Garantia não encontrada");
  const ctx = await projectContext(w.projectId);
  const c = ctx.p.client;
  const doc = await storeGeneratedPdf({
    organizationId: w.organizationId,
    clientId: c.id,
    projectId: w.projectId,
    type: "CERTIFICADO_GARANTIA",
    generatedFrom: `Warranty:${w.id}`,
    title: `Certificado de garantia — ${ctx.p.code}`,
    fileName: `certificado-garantia-${ctx.p.code}.pdf`,
    built: buildWarrantyCertificate({
      company: ctx.company,
      client: {
        name: c.name,
        document: c.document,
        phone: c.phone,
        email: c.email,
        address: ctx.address,
        city: c.city ? `${c.city}${c.state ? ` / ${c.state}` : ""}` : null,
        zipCode: c.zipCode,
      },
      project: { code: ctx.p.code, name: ctx.p.name },
      designer: null,
      consultant: c.seller?.name ?? null,
      installers: w.inspection?.installerNames ?? ctx.installers,
      purchaseDate: ctx.p.salesOrders[0]?.orderedAt ?? null,
      deliveryDate: ctx.p.productionOrder?.deliveredAt ?? null,
      inspectionDate: w.startsAt,
      ambientes: w.inspection?.ambientes ?? ctx.rooms,
      coverage: w.coverage as unknown as CoverageItem[],
      issuedAt: new Date(),
    }),
    visibleToClient: true,
    uploadedById: actorId,
    replacesId: w.certificateDocumentId,
  });
  await prisma.warranty.update({ where: { id: w.id }, data: { certificateDocumentId: doc.id } });
  return doc;
}

/** Job diário: componente da garantia a 30 dias do fim → avisa equipe e cliente, uma vez. */
export async function runWarrantyAlerts(now = new Date()) {
  const soon = new Date(now.getTime() + 31 * 86_400_000);
  // o fim geral é o maior prazo; componentes vencem antes, então olha as vigentes
  const list = await prisma.warranty.findMany({
    where: { endsAt: { gte: now }, startsAt: { lte: now } },
    include: { project: { select: { code: true, name: true, clientId: true, status: true } } },
  });
  let alerts = 0;
  for (const w of list) {
    if (w.project.status === "CANCELLED") continue;
    const due = warrantyAlertsDue(w.coverage as unknown as CoverageItem[], w.alertsSent, now).filter((x) => new Date(x.c.endsAt) <= soon);
    if (!due.length) continue;
    for (const x of due) {
      const quando = new Date(x.c.endsAt).toLocaleDateString("pt-BR");
      await notifyUsersWithPermission({
        organizationId: w.organizationId,
        permission: "warranty.manage",
        title: "Garantia perto do fim",
        message: `${w.project.code} — ${w.project.name}: a garantia de ${x.c.label.toLowerCase()} termina em ${quando} (${x.days} dia(s)).`,
      });
      void sendAutomation("WARRANTY_EXPIRING", {
        organizationId: w.organizationId,
        clientId: w.project.clientId,
        vars: { "projeto.codigo": w.project.code, "projeto.nome": w.project.name, "garantia.item": x.c.label, "garantia.fim": quando },
        dedupeKey: `warranty:${w.id}:${x.key}`,
      });
      alerts++;
    }
    await prisma.warranty.update({ where: { id: w.id }, data: { alertsSent: [...w.alertsSent, ...due.map((x) => x.key)] } });
  }
  return { alerts };
}

/** Job diário: revisão preventiva a 7 dias → lembra cliente (WhatsApp) e equipe (sino). */
export async function runMaintenanceReminders(now = new Date()) {
  const list = await prisma.preventiveMaintenance.findMany({
    where: { status: "SCHEDULED", remindedAt: null, dueAt: { lte: new Date(now.getTime() + 8 * 86_400_000) } },
    include: { project: { select: { code: true, name: true, clientId: true, status: true } } },
  });
  let reminded = 0;
  for (const m of list) {
    if (!maintenanceNeedsReminder(m, now) || m.project.status === "CANCELLED") continue;
    const quando = m.dueAt.toLocaleDateString("pt-BR");
    await notifyUsersWithPermission({
      organizationId: m.organizationId,
      permission: "warranty.manage",
      title: "Manutenção preventiva",
      message: `${m.project.code} — ${m.project.name}: ${m.label.toLowerCase()} prevista para ${quando}. Agende com o cliente.`,
    });
    void sendAutomation("MAINTENANCE_REMINDER", {
      organizationId: m.organizationId,
      clientId: m.project.clientId,
      vars: { "projeto.codigo": m.project.code, "projeto.nome": m.project.name, "manutencao.nome": m.label, "manutencao.data": quando },
      dedupeKey: `maintenance:${m.id}`,
    });
    await prisma.preventiveMaintenance.update({ where: { id: m.id }, data: { remindedAt: now } });
    reminded++;
  }
  return { reminded };
}
