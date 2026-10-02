/**
 * Etiquetas com código de barras e leitor: /api/production
 *
 *   GET  /projects/:projectId/labels.pdf?format=a4|termica&pending=1
 *   GET  /projects/:projectId/checklist      conferência (sem baixa em vermelho na tela)
 *   POST /scan { code, mode }                leitura do código de barras
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { checklistSummary, normalizeScan, scanOutcome } from "./labels.rules";
import { ensureCodes, labelsPdf } from "./labels.service";
import { SECTOR_LABEL, type ProductionSector } from "./shopfloor.service";

const router = Router();
router.use(authenticate);

const checkSelect = {
  id: true, code: true, descricao: true, ambiente: true, modulo: true, medidas: true, material: true, fita: true,
  quantidade: true, status: true, sector: true, position: true, completedAt: true,
} as const;

async function checklistFor(orderId: string) {
  const items = await prisma.productionItem.findMany({ where: { orderId }, select: checkSelect, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return {
    summary: checklistSummary(items),
    items: items.map((i) => ({ ...i, sectorLabel: i.sector ? SECTOR_LABEL[i.sector as ProductionSector] : null })),
  };
}

router.get(
  "/projects/:projectId/labels.pdf",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const organizationId = req.user!.organizationId;
    const q = z.object({ format: z.enum(["a4", "termica"]).catch("a4"), pending: z.string().optional() }).parse(req.query);
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, organizationId },
      select: { code: true, client: { select: { name: true } }, productionOrder: { select: { id: true } } },
    });
    if (!project) throw new NotFoundError("Projeto não encontrado");
    if (!project.productionOrder) throw new BadRequestError("Este projeto ainda não tem itens de produção");
    await ensureCodes(organizationId, project.productionOrder.id);

    const all = await prisma.productionItem.findMany({
      where: { orderId: project.productionOrder.id, status: { not: "CANCELLED" } },
      select: checkSelect,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    // a numeração "3/45" é sempre sobre o projeto inteiro, mesmo imprimindo só o que falta
    const numbered = all.map((i, idx) => ({ ...i, position: idx + 1 }));
    const items = q.pending ? numbered.filter((i) => i.status !== "DONE") : numbered;
    if (!items.length) throw new BadRequestError("Não há itens para etiquetar");

    const pdf = await labelsPdf({
      projectCode: project.code,
      client: project.client?.name ?? null,
      format: q.format,
      items: items.map((i) => ({ ...i, code: i.code! })),
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="etiquetas-${project.code}.pdf"`);
    return res.send(pdf);
  })
);

router.get(
  "/projects/:projectId/checklist",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, organizationId: req.user!.organizationId },
      select: { id: true, code: true, name: true, productionOrder: { select: { id: true } } },
    });
    if (!project) throw new NotFoundError("Projeto não encontrado");
    const list = project.productionOrder ? await checklistFor(project.productionOrder.id) : { summary: checklistSummary([]), items: [] };
    return ok(res, { project: { id: project.id, code: project.code, name: project.name }, ...list });
  })
);

router.post(
  "/scan",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const input = z.object({ code: z.string().max(60), mode: z.enum(["done", "advance"]).default("done") }).parse(req.body);
    const code = normalizeScan(input.code);
    if (!code) throw new BadRequestError("Código não reconhecido — leia de novo a etiqueta");

    const item = await prisma.productionItem.findFirst({
      where: { organizationId: req.user!.organizationId, code },
      select: { ...checkSelect, startedAt: true, orderId: true, order: { select: { project: { select: { id: true, code: true, name: true } } } } },
    });
    if (!item) throw new NotFoundError(`Nenhum item com o código ${code}`);

    const outcome = scanOutcome(item, input.mode);
    if (outcome.kind === "ERROR") throw new BadRequestError(outcome.message);
    if (outcome.kind === "MOVE") {
      const now = new Date();
      await prisma.productionItem.update({
        where: { id: item.id },
        data: {
          status: outcome.status,
          sector: outcome.sector,
          startedAt: item.startedAt ?? now,
          completedAt: outcome.status === "DONE" ? now : null,
          events: { create: { action: outcome.event, sector: outcome.eventSector as never, note: "Leitura do código de barras", createdById: req.user!.id } },
        },
      });
    }

    const list = await checklistFor(item.orderId);
    const fresh = list.items.find((i) => i.id === item.id)!;
    return ok(res, { result: outcome.kind === "ALREADY" ? "ALREADY" : "OK", item: fresh, project: item.order.project, summary: list.summary }, outcome.message);
  })
);

export default router;
