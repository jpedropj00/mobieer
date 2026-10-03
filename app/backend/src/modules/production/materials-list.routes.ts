/**
 * Lista de materiais a comprar (o papel "MATERIAIS" da semana):
 *
 *   GET   /api/production/materials                         todos os projetos com lista
 *   GET   /api/production/projects/:projectId/materials     lista do projeto
 *   POST  /api/production/projects/:projectId/materials/import   puxa do arquivo do Promob
 *   POST  /api/production/projects/:projectId/materials/lines    linha digitada
 *   PATCH /api/production/projects/:projectId/materials/lines/:lineId   comprado / quantidade / observação
 *   DELETE /api/production/projects/:projectId/materials/lines/:lineId
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { draftsFromPromob, mergeDrafts, summary, type MaterialLine } from "./materials-list.rules";

const router = Router();
router.use(authenticate);

const PREFIX = "materials-list.";
const key = (projectId: string) => `${PREFIX}${projectId}`;

type Stored = { lines: MaterialLine[]; importId?: string | null; importedAt?: string | null };

function parse(value: string | undefined): Stored {
  try {
    const v = JSON.parse(value ?? "") as Stored;
    return { lines: Array.isArray(v.lines) ? v.lines : [], importId: v.importId ?? null, importedAt: v.importedAt ?? null };
  } catch {
    return { lines: [] };
  }
}

async function projectFor(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, code: true, name: true, client: { select: { name: true } } } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

async function load(projectId: string): Promise<Stored> {
  const row = await prisma.setting.findUnique({ where: { key: key(projectId) } });
  return parse(row?.value);
}

async function save(projectId: string, data: Stored) {
  const value = JSON.stringify(data);
  await prisma.setting.upsert({ where: { key: key(projectId) }, create: { key: key(projectId), value }, update: { value } });
}

router.get(
  "/materials",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: PREFIX } } });
    const byProject = new Map(rows.map((r) => [r.key.slice(PREFIX.length), parse(r.value)]));
    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.organizationId, id: { in: [...byProject.keys()] } },
      select: { id: true, code: true, name: true, client: { select: { name: true } } },
    });
    const lists = projects
      .map((p) => ({ project: { id: p.id, code: p.code, name: p.name, client: p.client.name }, lines: byProject.get(p.id)!.lines, summary: summary(byProject.get(p.id)!.lines) }))
      .filter((l) => l.lines.length)
      // quem tem compra pendente primeiro
      .sort((a, b) => Number(a.summary.done) - Number(b.summary.done) || a.project.client.localeCompare(b.project.client, "pt-BR"));
    return ok(res, lists);
  })
);

router.get(
  "/projects/:projectId/materials",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const data = await load(p.id);
    const imports = await prisma.promobImport.findMany({
      where: { projectId: p.id, status: "PARSED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, format: true, createdAt: true },
    });
    return ok(res, { ...data, summary: summary(data.lines), imports });
  })
);

router.post(
  "/projects/:projectId/materials/import",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const { importId } = z.object({ importId: z.string().optional() }).parse(req.body ?? {});
    const imp = await prisma.promobImport.findFirst({
      where: { projectId: p.id, status: "PARSED", ...(importId ? { id: importId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, fileName: true, parsedJson: true },
    });
    if (!imp) throw new BadRequestError("Este projeto ainda não tem arquivo do Promob lido. Envie o arquivo na aba Promob.");
    const drafts = draftsFromPromob(imp.parsedJson as never);
    if (!drafts.length) throw new BadRequestError(`O arquivo ${imp.fileName} não traz materiais (chapas ou fitas). Use o CSV do plano de corte.`);
    const cur = await load(p.id);
    const lines = mergeDrafts(cur.lines, drafts, randomUUID);
    const data: Stored = { lines, importId: imp.id, importedAt: new Date().toISOString() };
    await save(p.id, data);
    return ok(res, { ...data, summary: summary(lines) }, `Lista atualizada a partir de ${imp.fileName}`);
  })
);

const lineInput = z.object({
  room: z.string().trim().min(1, "Informe o ambiente").max(80),
  material: z.string().trim().min(1, "Informe o material").max(160),
  qty: z.coerce.number().min(0).max(100000).nullable().optional(),
  unit: z.enum(["chapa", "m", "un"]).default("chapa"),
  note: z.string().trim().max(300).optional().nullable(),
});

router.post(
  "/projects/:projectId/materials/lines",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const input = lineInput.parse(req.body);
    const cur = await load(p.id);
    const lines = [...cur.lines, { id: randomUUID(), room: input.room, material: input.material, qty: input.qty ?? null, unit: input.unit, note: input.note || null, bought: false, source: "MANUAL" as const }];
    await save(p.id, { ...cur, lines });
    return ok(res, { ...cur, lines, summary: summary(lines) }, "Material adicionado");
  })
);

router.patch(
  "/projects/:projectId/materials/lines/:lineId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const input = z.object({ bought: z.boolean().optional(), qty: z.coerce.number().min(0).max(100000).nullable().optional(), note: z.string().trim().max(300).nullable().optional() }).parse(req.body);
    const cur = await load(p.id);
    if (!cur.lines.some((l) => l.id === req.params.lineId)) throw new NotFoundError("Material não encontrado na lista");
    const lines = cur.lines.map((l) => {
      if (l.id !== req.params.lineId) return l;
      const next = { ...l };
      if (input.qty !== undefined) next.qty = input.qty;
      if (input.note !== undefined) next.note = input.note || null;
      if (input.bought !== undefined) {
        next.bought = input.bought;
        next.boughtAt = input.bought ? new Date().toISOString() : null;
        next.boughtBy = input.bought ? req.user!.name : null;
      }
      return next;
    });
    await save(p.id, { ...cur, lines });
    return ok(res, { ...cur, lines, summary: summary(lines) });
  })
);

router.delete(
  "/projects/:projectId/materials/lines/:lineId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const cur = await load(p.id);
    const lines = cur.lines.filter((l) => l.id !== req.params.lineId);
    await save(p.id, { ...cur, lines });
    return ok(res, { ...cur, lines, summary: summary(lines) }, "Material removido");
  })
);

export default router;
