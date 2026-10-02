/**
 * Cronograma de montagem do cliente: /api/production/projects/:projectId/installation-schedule
 *
 *   GET          dados salvos (ou uma sugestão para começar)
 *   PUT          salva
 *   GET  .pdf    gera o PDF
 *   POST /publish  gera e guarda nos documentos do projeto (aparece no portal)
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { holidaysForYear } from "../hr/holidays.service";
import { storeGeneratedPdf } from "../docgen/docgen.service";
import { splitCityFromAddress } from "../aftersales/warranty-manual.rules";
import { DEFAULT_SCHEDULE_TEXT, addBusinessDays, buildWeeks, inspectionDate, weekendsBetween, type InstallationScheduleData } from "./installation-schedule.rules";
import { installationSchedulePdf } from "./installation-schedule.pdf";

const router = Router();
router.use(authenticate);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const lines = (max: number, n: number) => z.array(z.string().trim().max(max)).max(n);
const input = z.object({
  start: day,
  end: day,
  ambientes: z.string().trim().max(300).default(""),
  address: z.string().trim().max(300).default(""),
  stages: z.array(lines(200, 12)).max(20),
  highlights: lines(400, 6),
  obs: lines(400, 6),
  closing: lines(400, 6),
  extra: lines(400, 10),
});

async function projectFor(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true, code: true, name: true, organizationId: true,
      client: { select: { id: true, name: true, address: true, street: true, addressNumber: true, district: true, city: true, state: true } },
      quotes: { where: { status: "APPROVED", kind: "PADRAO" }, orderBy: { approvedAt: "desc" }, take: 1, select: { items: { select: { room: true }, orderBy: { position: "asc" } } } },
    },
  });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

async function holidaySet(organizationId: string, start: string, end: string) {
  const years = new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))]);
  const all = (await Promise.all([...years].map((y) => holidaysForYear(organizationId, y)))).flat();
  // ponto facultativo não para a montagem
  return new Set(all.filter((h) => !h.optional).map((h) => h.date));
}

const key = (projectId: string) => `installation-schedule.${projectId}`;

async function load(projectId: string): Promise<InstallationScheduleData | null> {
  const row = await prisma.setting.findUnique({ where: { key: key(projectId) } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as InstallationScheduleData;
  } catch {
    return null;
  }
}

/** Sugestão para um cronograma novo: começa na próxima segunda, 15 dias úteis. */
async function suggestion(p: Awaited<ReturnType<typeof projectFor>>): Promise<InstallationScheduleData> {
  const today = new Date();
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + ((8 - today.getUTCDay()) % 7 || 7)));
  const start = monday.toISOString().slice(0, 10);
  const hol = await holidaySet(p.organizationId, start, `${Number(start.slice(0, 4)) + 1}-12-31`);
  const end = addBusinessDays(start, 15, hol);
  const c = p.client;
  const street = [c.street && `${c.street}${c.addressNumber ? `, ${c.addressNumber}` : ""}`, c.district].filter(Boolean).join(" — ");
  const legacy = splitCityFromAddress(c.address);
  const city = c.city ? `${c.city} - ${c.state ?? ""}`.trim() : legacy.city?.replace(" / ", " - ");
  const rooms = [...new Set((p.quotes[0]?.items ?? []).map((i) => i.room?.trim()).filter((r): r is string => Boolean(r)))];
  return {
    start,
    end,
    ambientes: rooms.join(", ") || p.name,
    address: [street || legacy.street, city].filter(Boolean).join(" — "),
    stages: [],
    ...DEFAULT_SCHEDULE_TEXT,
  };
}

async function compute(organizationId: string, data: InstallationScheduleData) {
  const hol = await holidaySet(organizationId, data.start, data.end);
  return { weeks: buildWeeks(data.start, data.end, hol), inspection: inspectionDate(data.end, hol), weekends: weekendsBetween(data.start, data.end) };
}

router.get(
  "/projects/:projectId/installation-schedule",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const saved = await load(p.id);
    const data = saved ?? (await suggestion(p));
    return ok(res, { saved: Boolean(saved), data, ...(await compute(p.organizationId, data)) });
  })
);

// pré-visualiza as semanas de um período sem salvar (a tela chama ao mudar as datas)
router.get(
  "/projects/:projectId/installation-schedule/weeks",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const q = z.object({ start: day, end: day }).parse(req.query);
    if (q.end < q.start) throw new BadRequestError("O fim precisa ser depois do início");
    return ok(res, await compute(req.user!.organizationId, { ...q } as InstallationScheduleData));
  })
);

router.put(
  "/projects/:projectId/installation-schedule",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const data = input.parse(req.body) as InstallationScheduleData;
    if (data.end < data.start) throw new BadRequestError("O fim precisa ser depois do início");
    const value = JSON.stringify(data);
    await prisma.setting.upsert({ where: { key: key(p.id) }, create: { key: key(p.id), value }, update: { value } });
    return ok(res, { data, ...(await compute(p.organizationId, data)) }, "Cronograma salvo");
  })
);

async function pdfFor(projectId: string, organizationId: string) {
  const p = await projectFor(projectId, organizationId);
  const data = (await load(p.id)) ?? (await suggestion(p));
  const extra = await compute(p.organizationId, data);
  return { p, pdf: await installationSchedulePdf({ ...data, client: p.client.name, ...extra }) };
}

router.get(
  "/projects/:projectId/installation-schedule.pdf",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const { p, pdf } = await pdfFor(req.params.projectId, req.user!.organizationId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cronograma-${p.code}.pdf"`);
    return res.send(pdf);
  })
);

router.post(
  "/projects/:projectId/installation-schedule/publish",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const { p, pdf } = await pdfFor(req.params.projectId, req.user!.organizationId);
    const previous = await prisma.projectDocument.findFirst({ where: { projectId: p.id, type: "CRONOGRAMA", generatedFrom: `InstallationSchedule:${p.id}` }, orderBy: { version: "desc" }, select: { id: true } });
    const doc = await storeGeneratedPdf({
      organizationId: p.organizationId,
      clientId: p.client.id,
      projectId: p.id,
      type: "CRONOGRAMA",
      generatedFrom: `InstallationSchedule:${p.id}`,
      title: `Cronograma de montagem — ${p.code}`,
      fileName: `cronograma-${p.code}.pdf`,
      buffer: pdf,
      visibleToClient: true,
      uploadedById: req.user!.id,
      replacesId: previous?.id ?? null,
    });
    return ok(res, { documentId: doc.id, version: doc.version }, `Cronograma salvo nos documentos do projeto (versão ${doc.version})`);
  })
);

export default router;
