/**
 * Acréscimos do financeiro: /api/finance
 *
 *   GET    /custom-categories              categorias criadas pela loja
 *   POST   /custom-categories              { type, name }
 *   DELETE /custom-categories              { type, name } (não altera lançamentos já feitos)
 *
 *   GET    /investment-goals               metas de investimento + totais
 *   POST   /investment-goals               { title, cost, saved?, targetDate?, notes? }
 *   PATCH  /investment-goals/:id
 *   DELETE /investment-goals/:id
 *
 * Ficam em `Setting` (uma chave por organização), sem tabela nova.
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
import { addCategory, goalProgress, goalsSummary, normalizeCategories, normalizeGoals, removeCategory, sortGoals, type InvestmentGoal } from "./finance-extras.rules";

const router = Router();
router.use(authenticate);

const catKey = (org: string) => `finance.custom-categories.${org}`;
const goalKey = (org: string) => `finance.investment-goals.${org}`;

async function read(key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({ where: { key } });
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}
async function write(key: string, data: unknown) {
  const value = JSON.stringify(data);
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// ---------------------------------------------------------------- categorias

const catInput = z.object({ type: z.enum(["RECEITA", "DESPESA"]), name: z.string().trim().min(1, "Informe o nome da categoria").max(60), builtin: z.array(z.string().max(80)).max(60).optional() });

router.get(
  "/custom-categories",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => ok(res, normalizeCategories(await read(catKey(req.user!.organizationId)))))
);

router.post(
  "/custom-categories",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = catInput.parse(req.body);
    const key = catKey(req.user!.organizationId);
    let result;
    try {
      result = addCategory(normalizeCategories(await read(key)), input.type, input.name, input.builtin ?? []);
    } catch (e) {
      throw new BadRequestError(e instanceof Error ? e.message : "Categoria inválida");
    }
    if (result.added) await write(key, result.categories);
    return ok(res, result.categories, result.added ? "Categoria adicionada" : "Essa categoria já existe");
  })
);

router.delete(
  "/custom-categories",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = catInput.parse(req.body);
    const key = catKey(req.user!.organizationId);
    const next = removeCategory(normalizeCategories(await read(key)), input.type, input.name);
    await write(key, next);
    return ok(res, next, "Categoria removida da lista. Os lançamentos já feitos com ela continuam como estão.");
  })
);

// ---------------------------------------------------------------- metas de investimento

const money = z.coerce.number().min(0, "Valor inválido").max(1_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const goalInput = z.object({
  title: z.string().trim().min(2, "Informe o que vocês querem implantar").max(120),
  cost: money,
  saved: money.default(0),
  targetDate: day.nullable().optional(),
  notes: z.string().trim().max(600).nullable().optional(),
});

const view = (goals: InvestmentGoal[]) => ({ goals: sortGoals(goals).map((g) => ({ ...g, ...goalProgress(g) })), summary: goalsSummary(goals) });

router.get(
  "/investment-goals",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => ok(res, view(normalizeGoals(await read(goalKey(req.user!.organizationId))))))
);

router.post(
  "/investment-goals",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = goalInput.parse(req.body);
    const key = goalKey(req.user!.organizationId);
    const goals = normalizeGoals(await read(key));
    if (goals.length >= 200) throw new BadRequestError("Limite de 200 metas atingido. Remova as antigas.");
    const goal: InvestmentGoal = { id: randomUUID(), title: input.title, cost: input.cost, saved: Math.min(input.saved, input.cost), targetDate: input.targetDate ?? null, notes: input.notes || null, done: false, doneAt: null, createdAt: new Date().toISOString(), createdBy: req.user!.name };
    await write(key, [...goals, goal]);
    return ok(res, view([...goals, goal]), "Meta de investimento adicionada");
  })
);

router.patch(
  "/investment-goals/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = goalInput.partial().extend({ done: z.boolean().optional() }).parse(req.body);
    const key = goalKey(req.user!.organizationId);
    const goals = normalizeGoals(await read(key));
    if (!goals.some((g) => g.id === req.params.id)) throw new NotFoundError("Meta não encontrada");
    const next = goals.map((g) => {
      if (g.id !== req.params.id) return g;
      const cost = input.cost ?? g.cost;
      const u: InvestmentGoal = { ...g, title: input.title ?? g.title, cost, saved: Math.min(input.saved ?? g.saved, cost), targetDate: input.targetDate === undefined ? g.targetDate : input.targetDate, notes: input.notes === undefined ? g.notes : input.notes || null };
      if (input.done !== undefined && input.done !== g.done) {
        u.done = input.done;
        u.doneAt = input.done ? new Date().toISOString() : null;
      }
      return u;
    });
    await write(key, next);
    return ok(res, view(next), "Meta atualizada");
  })
);

router.delete(
  "/investment-goals/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const key = goalKey(req.user!.organizationId);
    const goals = normalizeGoals(await read(key));
    const next = goals.filter((g) => g.id !== req.params.id);
    if (next.length === goals.length) throw new NotFoundError("Meta não encontrada");
    await write(key, next);
    return ok(res, view(next), "Meta removida");
  })
);

export default router;
