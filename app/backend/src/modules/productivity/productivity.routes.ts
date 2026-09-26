/**
 * §5 — Produtividade interna. Cada pessoa vê a própria; a equipe exige
 * productivity.read; metas exigem productivity.manage. A análise por IA recebe
 * só os números que quem pediu já pode ver — nunca dados de outra pessoa.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { ProductivityMetric } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { aiEnabled, aiJson, AiError } from "../../lib/ai";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { computeIndicators, factualSummary, goalProgress, hasData, lastMonths, monthRange, previousMonth } from "./productivity.rules";
import { loadMonth } from "./productivity.service";

const router = Router();
router.use(authenticate);

const monthOf = (req: Request) => {
  const now = new Date();
  const m = String(req.query.month ?? req.body?.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  try {
    return monthRange(m);
  } catch (e) {
    throw new BadRequestError(e instanceof Error ? e.message : "Mês inválido");
  }
};

/** A própria pessoa sempre; outra pessoa só com productivity.read e na mesma organização. */
async function targetUser(req: Request, userId: string) {
  if (userId !== req.user!.id && !req.user!.permissions.includes("productivity.read")) {
    throw new ForbiddenError("Você só pode ver a sua própria produtividade");
  }
  const u = await prisma.user.findFirst({ where: { id: userId, organizationId: req.user!.organizationId }, select: { id: true, name: true, position: true, sector: true } });
  if (!u) throw new NotFoundError("Usuário não encontrado");
  return u;
}

async function userMonth(orgId: string, userId: string, month: string, now: Date) {
  const range = monthRange(month);
  const raw = (await loadMonth(orgId, range, [userId], now)).get(userId)!;
  return computeIndicators(raw, range, now);
}

// GET /api/productivity?month=YYYY-MM — a equipe no mês
router.get(
  "/",
  requirePermission("productivity.read"),
  asyncHandler(async (req, res) => {
    const range = monthOf(req);
    const now = new Date();
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, status: "ACTIVE", role: { name: { not: "MONTADOR" } } },
      select: { id: true, name: true, position: true, sector: true, role: { select: { label: true } } },
      orderBy: { name: "asc" },
    });
    const ids = users.map((u) => u.id);
    const [cur, prev, goals] = await Promise.all([
      loadMonth(req.user!.organizationId, range, ids, now),
      loadMonth(req.user!.organizationId, monthRange(previousMonth(range.month)), ids, now),
      prisma.employeeGoal.findMany({ where: { organizationId: req.user!.organizationId, month: range.month } }),
    ]);
    const prevRange = monthRange(previousMonth(range.month));
    const rows = users.map((u) => {
      const ind = computeIndicators(cur.get(u.id)!, range, now);
      const before = computeIndicators(prev.get(u.id)!, prevRange, now);
      return {
        user: { id: u.id, name: u.name, position: u.position, sector: u.sector, role: u.role.label },
        hasData: hasData(ind),
        indicators: ind,
        previous: before,
        goals: goalProgress(goals.filter((g) => g.userId === u.id), ind),
      };
    });
    const withData = rows.filter((r) => r.hasData);
    const sum = (f: (r: (typeof rows)[number]) => number) => withData.reduce((s, r) => s + f(r), 0);
    return ok(res, {
      month: range.month,
      totals: {
        people: withData.length,
        activitiesDone: sum((r) => r.indicators.activitiesDone),
        productionSteps: sum((r) => r.indicators.productionSteps),
        productionMinutes: sum((r) => r.indicators.productionMinutes),
        tasksDone: sum((r) => r.indicators.tasksDone),
        tasksOverdueOpen: sum((r) => r.indicators.tasksOverdueOpen),
      },
      rows,
    });
  })
);

// GET /api/productivity/users/:userId?month=&months=6 — detalhe e evolução
router.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const u = await targetUser(req, req.params.userId);
    const range = monthOf(req);
    const n = Math.min(12, Math.max(2, Number(req.query.months ?? 6) || 6));
    const now = new Date();
    const months = lastMonths(range.month, n);
    const series = await Promise.all(months.map(async (m) => ({ month: m, indicators: await userMonth(req.user!.organizationId, u.id, m, now) })));
    const goals = await prisma.employeeGoal.findMany({ where: { userId: u.id, month: range.month } });
    const cur = series[series.length - 1].indicators;
    return ok(res, { user: u, month: range.month, indicators: cur, goals: goalProgress(goals, cur), series });
  })
);

// POST /api/productivity/users/:userId/summary { month } — resumo mensal (IA quando configurada)
router.post(
  "/users/:userId/summary",
  asyncHandler(async (req, res) => {
    const u = await targetUser(req, req.params.userId);
    const range = monthOf(req);
    const now = new Date();
    const [cur, prev, goals] = await Promise.all([
      userMonth(req.user!.organizationId, u.id, range.month, now),
      userMonth(req.user!.organizationId, u.id, previousMonth(range.month), now),
      prisma.employeeGoal.findMany({ where: { userId: u.id, month: range.month } }),
    ]);
    const gp = goalProgress(goals, cur);
    const base = factualSummary(u.name, range.month, cur, prev, gp);
    if (!aiEnabled() || !hasData(cur)) return ok(res, { source: "HEURISTIC" as const, ...base });

    try {
      const ai = await aiJson<{ resumo?: string; evolucao?: string; gargalos?: string[]; concluidas?: string }>({
        system:
          "Você analisa produtividade de uma fábrica de móveis planejados. Use SOMENTE os números recebidos. Não invente dados, não atribua causas que os números não mostram, não avalie a pessoa (nada de 'ótimo', 'fraco', 'preguiçoso'). Constate fatos e tendências. Português do Brasil. Responda em JSON.",
        prompt: JSON.stringify({
          instrucao: "Monte: resumo (2-3 frases), evolucao (comparação com o mês anterior), gargalos (lista curta, só o que os números mostram), concluidas (o que foi entregue).",
          pessoa: u.name,
          mes: range.month,
          mesAtual: cur,
          mesAnterior: prev,
          metas: gp,
          fatosBase: base,
        }),
        maxTokens: 700,
      });
      return ok(res, {
        source: "AI" as const,
        text: [ai.resumo, ai.evolucao, ai.concluidas].filter(Boolean).join(" "),
        highlights: base.highlights,
        bottlenecks: Array.isArray(ai.gargalos) && ai.gargalos.length ? ai.gargalos.map(String) : base.bottlenecks,
      });
    } catch (e) {
      // IA fora do ar não tira o resumo do ar: devolve o factual e diz o motivo
      return ok(res, { source: "HEURISTIC" as const, ...base, aiError: e instanceof AiError ? e.message : "falha na IA" });
    }
  })
);

// PUT /api/productivity/users/:userId/goals { month, goals: [{ metric, target }] }
router.put(
  "/users/:userId/goals",
  requirePermission("productivity.manage"),
  asyncHandler(async (req, res) => {
    const u = await targetUser(req, req.params.userId);
    const input = z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        goals: z.array(z.object({ metric: z.nativeEnum(ProductivityMetric), target: z.coerce.number().int().min(0).max(100000) })).max(4),
      })
      .parse(req.body);
    await prisma.$transaction([
      prisma.employeeGoal.deleteMany({ where: { userId: u.id, month: input.month, metric: { notIn: input.goals.map((g) => g.metric) } } }),
      ...input.goals.map((g) =>
        prisma.employeeGoal.upsert({
          where: { userId_month_metric: { userId: u.id, month: input.month, metric: g.metric } },
          create: { organizationId: req.user!.organizationId, userId: u.id, month: input.month, metric: g.metric, target: g.target, createdById: req.user!.id },
          update: { target: g.target },
        })
      ),
    ]);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "PRODUCTIVITY_GOALS_SET", entity: "User", entityId: u.id, details: input } });
    return ok(res, { saved: input.goals.length }, "Metas salvas");
  })
);

export default router;
