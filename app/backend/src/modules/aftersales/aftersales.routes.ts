/**
 * §35/§36/§37/§38 — Pós-venda: vistoria técnica, garantia, certificado e
 * manutenção preventiva. Ler: organization.read. Vistoriar:
 * inspections.manage (técnico, assistência). Garantia e revisões:
 * warranty.manage.
 */
import { Router } from "express";
import { z } from "zod";
import { InspectionItemStatus, SiteInspectionResult } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { projectScope } from "../../lib/scope";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { assinaturaCabe, isAssinaturaValida } from "../contractors/documents.service";
import { registerFileEntity } from "../files/files.service";
import { RESULT_LABEL, checklistRows, coverageState, maintenanceSchedule, type CoverageItem } from "./aftersales.rules";
import { MAINTENANCE_MONTHS_SETTING, completeInspection, issueCertificate, loadMaintenanceMonths, openWarranty } from "./aftersales.service";

// fotos da vistoria no registro central de arquivos
registerFileEntity("SiteInspection", {
  label: "Vistoria",
  read: ["organization.read"],
  write: ["inspections.manage"],
  resolve: async (u, id) => {
    const i = await prisma.siteInspection.findFirst({
      where: { id, organizationId: u.organizationId, project: projectScope(u) },
      select: { project: { select: { id: true, code: true, clientId: true } } },
    });
    return i ? { projectId: i.project.id, clientId: i.project.clientId, label: `Vistoria ${i.project.code}` } : null;
  },
});

const router = Router();
router.use(authenticate);

async function ensureProject(id: string, u: Express.Request["user"]) {
  const p = await prisma.project.findFirst({ where: { id, ...projectScope(u!) }, select: { id: true, code: true, name: true, status: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

const inspectionInclude = {
  technician: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: { orderBy: { position: "asc" as const } },
  reportDocument: { select: { id: true, title: true, version: true } },
} as const;

type InspectionRow = NonNullable<Awaited<ReturnType<typeof prisma.siteInspection.findFirst<{ include: typeof inspectionInclude }>>>>;

function serializeInspection(i: InspectionRow, photoCount = 0) {
  const answered = i.items.filter((x) => x.status).length;
  return {
    id: i.id,
    status: i.status,
    result: i.result,
    resultLabel: i.result ? RESULT_LABEL[i.result] : null,
    inspectedAt: i.inspectedAt,
    ambientes: i.ambientes,
    technician: i.technician,
    installerNames: i.installerNames,
    pendencias: i.pendencias,
    notes: i.notes,
    clientSignerName: i.clientSignerName,
    signedByClient: !!i.clientSignature,
    signedByTechnician: !!i.technicianSignature,
    completedAt: i.completedAt,
    createdBy: i.createdBy,
    createdAt: i.createdAt,
    report: i.reportDocument,
    progress: { answered, total: i.items.length, nonConforming: i.items.filter((x) => x.status === "NAO_CONFORME").length },
    photoCount,
    items: i.items.map((x) => ({ id: x.id, section: x.section, label: x.label, position: x.position, status: x.status, note: x.note })),
  };
}

// GET /api/aftersales/projects/:projectId — vistorias + garantia + revisões
router.get(
  "/projects/:projectId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user);
    const [inspections, warranty, maintenances] = await Promise.all([
      prisma.siteInspection.findMany({ where: { projectId: project.id }, include: inspectionInclude, orderBy: { inspectedAt: "desc" } }),
      prisma.warranty.findUnique({ where: { projectId: project.id }, include: { certificateDocument: { select: { id: true, title: true, version: true } } } }),
      prisma.preventiveMaintenance.findMany({ where: { projectId: project.id }, include: { doneBy: { select: { id: true, name: true } } }, orderBy: { dueAt: "asc" } }),
    ]);
    const photos = await prisma.fileRecord.groupBy({
      by: ["entityId"],
      where: { entity: "SiteInspection", entityId: { in: inspections.map((i) => i.id) } },
      _count: { _all: true },
    });
    const pc = new Map(photos.map((p) => [p.entityId, p._count._all]));
    const now = new Date();
    return ok(res, {
      inspections: inspections.map((i) => serializeInspection(i, pc.get(i.id) ?? 0)),
      warranty: warranty
        ? {
            id: warranty.id,
            startsAt: warranty.startsAt,
            endsAt: warranty.endsAt,
            coverage: (warranty.coverage as unknown as CoverageItem[]).map((c) => coverageState(c, now)),
            conditions: warranty.conditions,
            exclusions: warranty.exclusions.split("\n"),
            certificate: warranty.certificateDocument,
          }
        : null,
      maintenances: maintenances.map((m) => ({
        id: m.id,
        label: m.label,
        monthsAfter: m.monthsAfter,
        dueAt: m.dueAt,
        status: m.status,
        overdue: m.status === "SCHEDULED" && m.dueAt < now,
        remindedAt: m.remindedAt,
        doneAt: m.doneAt,
        doneBy: m.doneBy,
        notes: m.notes,
      })),
    });
  })
);

// ============================================================
// Vistoria
// ============================================================

// POST /api/aftersales/projects/:projectId/inspections — abre com o checklist padrão
router.post(
  "/projects/:projectId/inspections",
  requirePermission("inspections.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user);
    if (project.status === "CANCELLED") throw new BadRequestError("Projeto cancelado não recebe vistoria");
    const draft = await prisma.siteInspection.findFirst({ where: { projectId: project.id, status: "DRAFT" }, select: { id: true } });
    if (draft) throw new BadRequestError("Já existe uma vistoria em preenchimento para este projeto");
    const input = z
      .object({
        inspectedAt: z.coerce.date().optional(),
        ambientes: z.string().trim().max(500).optional().nullable(),
        installerNames: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body ?? {});
    const created = await prisma.siteInspection.create({
      data: {
        organizationId: req.user!.organizationId,
        projectId: project.id,
        inspectedAt: input.inspectedAt ?? new Date(),
        ambientes: input.ambientes || null,
        installerNames: input.installerNames || null,
        technicianId: req.user!.id,
        createdById: req.user!.id,
        items: { create: checklistRows() },
      },
      include: inspectionInclude,
    });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "INSPECTION_CREATED", entity: "SiteInspection", entityId: created.id, details: { project: project.code } } });
    return ok(res, serializeInspection(created), "Vistoria aberta com o checklist padrão");
  })
);

const patchSchema = z.object({
  inspectedAt: z.coerce.date().optional(),
  ambientes: z.string().trim().max(500).optional().nullable(),
  installerNames: z.string().trim().max(500).optional().nullable(),
  technicianId: z.string().min(1).optional().nullable(),
  pendencias: z.string().trim().max(5000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  items: z
    .array(z.object({ id: z.string().min(1), status: z.nativeEnum(InspectionItemStatus).nullable().optional(), note: z.string().trim().max(500).optional().nullable() }))
    .max(200)
    .optional(),
});

// PATCH /api/aftersales/inspections/:id — salva o preenchimento (rascunho)
router.patch(
  "/inspections/:id",
  requirePermission("inspections.manage"),
  asyncHandler(async (req, res) => {
    const input = patchSchema.parse(req.body);
    const insp = await prisma.siteInspection.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId, project: projectScope(req.user!) },
      select: { id: true, status: true, items: { select: { id: true } } },
    });
    if (!insp) throw new NotFoundError("Vistoria não encontrada");
    if (insp.status === "COMPLETED") throw new BadRequestError("Vistoria concluída não pode ser alterada — o relatório já foi emitido");
    if (input.technicianId) {
      const u = await prisma.user.findFirst({ where: { id: input.technicianId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!u) throw new BadRequestError("Técnico inválido");
    }
    const own = new Set(insp.items.map((i) => i.id));
    if (input.items?.some((i) => !own.has(i.id))) throw new BadRequestError("Item não pertence a esta vistoria");

    await prisma.$transaction([
      prisma.siteInspection.update({
        where: { id: insp.id },
        data: {
          inspectedAt: input.inspectedAt,
          ambientes: input.ambientes === undefined ? undefined : input.ambientes || null,
          installerNames: input.installerNames === undefined ? undefined : input.installerNames || null,
          technicianId: input.technicianId === undefined ? undefined : input.technicianId,
          pendencias: input.pendencias === undefined ? undefined : input.pendencias || null,
          notes: input.notes === undefined ? undefined : input.notes || null,
        },
      }),
      ...(input.items ?? []).map((i) =>
        prisma.siteInspectionItem.update({
          where: { id: i.id },
          data: { status: i.status === undefined ? undefined : i.status, note: i.note === undefined ? undefined : i.note || null },
        })
      ),
    ]);
    const full = await prisma.siteInspection.findUniqueOrThrow({ where: { id: insp.id }, include: inspectionInclude });
    return ok(res, serializeInspection(full), "Vistoria salva");
  })
);

const signature = z
  .string()
  .optional()
  .nullable()
  .refine((v) => !v || (isAssinaturaValida(v) && assinaturaCabe(v)), "Assinatura inválida (envie o desenho em PNG)");

// POST /api/aftersales/inspections/:id/complete
router.post(
  "/inspections/:id/complete",
  requirePermission("inspections.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        result: z.nativeEnum(SiteInspectionResult),
        pendencias: z.string().trim().max(5000).optional().nullable(),
        notes: z.string().trim().max(5000).optional().nullable(),
        clientSignerName: z.string().trim().max(200).optional().nullable(),
        clientSignature: signature,
        technicianSignature: signature,
      })
      .parse(req.body);
    const own = await prisma.siteInspection.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, project: projectScope(req.user!) }, select: { id: true } });
    if (!own) throw new NotFoundError("Vistoria não encontrada");
    if (input.clientSignature && !input.clientSignerName) throw new BadRequestError("Informe o nome de quem assinou pelo cliente");
    const r = await completeInspection({ inspectionId: own.id, organizationId: req.user!.organizationId, actorId: req.user!.id, ...input });
    const full = await prisma.siteInspection.findUniqueOrThrow({ where: { id: own.id }, include: inspectionInclude });
    return ok(
      res,
      { inspection: serializeInspection(full), warrantyId: r.warrantyId },
      r.warrantyId ? "Vistoria concluída — relatório, garantia e certificado emitidos" : "Vistoria concluída e relatório emitido"
    );
  })
);

// DELETE /api/aftersales/inspections/:id — só rascunho
router.delete(
  "/inspections/:id",
  requirePermission("inspections.manage"),
  asyncHandler(async (req, res) => {
    const insp = await prisma.siteInspection.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, project: projectScope(req.user!) }, select: { id: true, status: true } });
    if (!insp) throw new NotFoundError("Vistoria não encontrada");
    if (insp.status === "COMPLETED") throw new BadRequestError("Vistoria concluída faz parte do histórico do projeto e não pode ser excluída");
    await prisma.siteInspection.delete({ where: { id: insp.id } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "INSPECTION_DELETED", entity: "SiteInspection", entityId: insp.id } });
    return ok(res, { deleted: true }, "Rascunho de vistoria excluído");
  })
);

// ============================================================
// Garantia
// ============================================================

// POST /api/aftersales/projects/:projectId/warranty — abre sem vistoria no sistema
// (projetos entregues antes do módulo, vistoriados no papel)
router.post(
  "/projects/:projectId/warranty",
  requirePermission("warranty.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user);
    const { startsAt } = z.object({ startsAt: z.coerce.date() }).parse(req.body);
    if (startsAt.getTime() > Date.now() + 86_400_000) throw new BadRequestError("O início da garantia não pode ser no futuro");
    const existing = await prisma.warranty.findUnique({ where: { projectId: project.id }, select: { id: true } });
    if (existing) throw new BadRequestError("Este projeto já tem garantia registrada");
    const w = await openWarranty(project.id, null, startsAt, req.user!.id);
    return ok(res, { id: w.id }, "Garantia registrada e certificado emitido");
  })
);

// POST /api/aftersales/warranties/:id/certificate — emite nova versão do certificado
router.post(
  "/warranties/:id/certificate",
  requirePermission("warranty.manage"),
  asyncHandler(async (req, res) => {
    const w = await prisma.warranty.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, project: projectScope(req.user!) }, select: { id: true } });
    if (!w) throw new NotFoundError("Garantia não encontrada");
    const doc = await issueCertificate(w.id, req.user!.id);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "WARRANTY_CERTIFICATE_ISSUED", entity: "Warranty", entityId: w.id, details: { documentId: doc.id, version: doc.version } } });
    return ok(res, { documentId: doc.id, version: doc.version }, `Certificado emitido (versão ${doc.version})`);
  })
);

// ============================================================
// Manutenção preventiva
// ============================================================

// PATCH /api/aftersales/maintenances/:id { action?: DONE|CANCEL|REOPEN, dueAt?, notes? }
router.patch(
  "/maintenances/:id",
  requirePermission("warranty.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        action: z.enum(["DONE", "CANCEL", "REOPEN"]).optional(),
        dueAt: z.coerce.date().optional(),
        notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(req.body);
    const m = await prisma.preventiveMaintenance.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId, project: projectScope(req.user!) } });
    if (!m) throw new NotFoundError("Manutenção não encontrada");
    const data: Record<string, unknown> = {};
    if (input.action === "DONE") {
      if (m.status !== "SCHEDULED") throw new BadRequestError("Só revisão agendada pode ser concluída");
      Object.assign(data, { status: "DONE", doneAt: new Date(), doneById: req.user!.id });
    } else if (input.action === "CANCEL") {
      if (m.status !== "SCHEDULED") throw new BadRequestError("Só revisão agendada pode ser cancelada");
      if (!input.notes) throw new BadRequestError("Informe o motivo do cancelamento");
      data.status = "CANCELLED";
    } else if (input.action === "REOPEN") {
      if (m.status === "SCHEDULED") throw new BadRequestError("A revisão já está agendada");
      Object.assign(data, { status: "SCHEDULED", doneAt: null, doneById: null });
    }
    if (input.dueAt) {
      // nova data reabre o lembrete
      Object.assign(data, { dueAt: input.dueAt, remindedAt: null });
    }
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (!Object.keys(data).length) throw new BadRequestError("Nada para alterar");
    const updated = await prisma.preventiveMaintenance.update({ where: { id: m.id }, data });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: input.action ? `MAINTENANCE_${input.action}` : "MAINTENANCE_UPDATED", entity: "PreventiveMaintenance", entityId: m.id, details: { before: { status: m.status, dueAt: m.dueAt }, after: { status: updated.status, dueAt: updated.dueAt } } },
    });
    return ok(res, updated, input.action === "DONE" ? "Revisão registrada como feita" : input.action === "CANCEL" ? "Revisão cancelada" : "Revisão atualizada");
  })
);

// GET/PUT /api/aftersales/maintenance-months — calendário padrão (meses após a vistoria)
router.get(
  "/maintenance-months",
  requirePermission("organization.read"),
  asyncHandler(async (_req, res) => ok(res, { months: await loadMaintenanceMonths() }))
);
router.put(
  "/maintenance-months",
  requirePermission("warranty.manage"),
  asyncHandler(async (req, res) => {
    const { months } = z.object({ months: z.array(z.coerce.number().int().min(1).max(120)).max(12) }).parse(req.body);
    const clean = [...new Set(months)].sort((a, b) => a - b);
    await prisma.setting.upsert({ where: { key: MAINTENANCE_MONTHS_SETTING }, create: { key: MAINTENANCE_MONTHS_SETTING, value: JSON.stringify(clean) }, update: { value: JSON.stringify(clean) } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "MAINTENANCE_MONTHS_UPDATED", entity: "Setting", entityId: MAINTENANCE_MONTHS_SETTING, details: { months: clean } } });
    return ok(res, { months: clean, example: maintenanceSchedule(new Date(), clean).map((m) => m.label) }, "Calendário de revisões salvo (vale para garantias novas)");
  })
);

// ============================================================
// Painel
// ============================================================

// GET /api/aftersales/overview — o que o pós-venda precisa olhar hoje
router.get(
  "/overview",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const org = req.user!.organizationId;
    const scope = projectScope(req.user!);
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const [drafts, maintenances, warranties, awaitingInspection] = await Promise.all([
      prisma.siteInspection.findMany({
        where: { organizationId: org, status: "DRAFT", project: scope },
        select: { id: true, inspectedAt: true, project: { select: { id: true, code: true, name: true } } },
        orderBy: { inspectedAt: "asc" },
      }),
      prisma.preventiveMaintenance.findMany({
        where: { organizationId: org, status: "SCHEDULED", dueAt: { lte: in30 }, project: scope },
        select: { id: true, label: true, dueAt: true, project: { select: { id: true, code: true, name: true } } },
        orderBy: { dueAt: "asc" },
      }),
      prisma.warranty.findMany({
        where: { organizationId: org, endsAt: { gte: now }, project: scope },
        select: { id: true, coverage: true, project: { select: { id: true, code: true, name: true } } },
      }),
      // entregues sem vistoria concluída
      prisma.project.findMany({
        where: { ...scope, productionOrder: { stage: "DELIVERED" }, siteInspections: { none: { status: "COMPLETED" } }, warranty: null, status: { not: "CANCELLED" } },
        select: { id: true, code: true, name: true, productionOrder: { select: { deliveredAt: true } } },
        take: 50,
      }),
    ]);
    const expiring = warranties.flatMap((w) =>
      (w.coverage as unknown as CoverageItem[])
        .map((c) => coverageState(c, now))
        .filter((c) => c.state === "EXPIRING")
        .map((c) => ({ warrantyId: w.id, project: w.project, component: c.label, endsAt: c.endsAt, daysLeft: c.daysLeft }))
    );
    return ok(res, {
      awaitingInspection: awaitingInspection.map((p) => ({ project: { id: p.id, code: p.code, name: p.name }, deliveredAt: p.productionOrder?.deliveredAt ?? null })),
      draftInspections: drafts,
      maintenancesDue: maintenances.map((m) => ({ ...m, overdue: m.dueAt < now })),
      warrantiesExpiring: expiring.sort((a, b) => a.daysLeft - b.daysLeft),
    });
  })
);

export default router;
