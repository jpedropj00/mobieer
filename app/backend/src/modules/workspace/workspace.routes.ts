import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";

/**
 * Espaço pessoal do usuário: bloco de notas + planner semanal.
 * Tudo escopado a `req.user.id` — sem permissão especial, é privado.
 */
const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Segunda-feira (UTC, meia-noite) da semana que contém `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

// ============================ NOTAS ============================

router.get(
  "/notes",
  asyncHandler(async (req, res) => {
    const rows = await prisma.workspaceNote.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ pinned: "desc" }, { position: "asc" }, { updatedAt: "desc" }],
    });
    return ok(res, rows);
  })
);

router.post(
  "/notes",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().max(160).optional().nullable().or(z.literal("")),
        body: z.string().max(20000).default(""),
        color: z.string().trim().max(20).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    const max = await prisma.workspaceNote.aggregate({ where: { userId: req.user!.id }, _max: { position: true } });
    const note = await prisma.workspaceNote.create({
      data: {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        title: nn(input.title),
        body: input.body,
        color: nn(input.color),
        position: (max._max.position ?? 0) + 1,
      },
    });
    return ok(res, note, "Nota criada");
  })
);

router.patch(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const cur = await prisma.workspaceNote.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!cur) throw new NotFoundError("Nota não encontrada");
    const input = z
      .object({
        title: z.string().trim().max(160).optional().nullable().or(z.literal("")),
        body: z.string().max(20000).optional(),
        color: z.string().trim().max(20).optional().nullable().or(z.literal("")),
        pinned: z.boolean().optional(),
        position: z.number().int().optional(),
      })
      .parse(req.body);
    const note = await prisma.workspaceNote.update({
      where: { id: cur.id },
      data: {
        title: input.title === undefined ? undefined : nn(input.title),
        body: input.body,
        color: input.color === undefined ? undefined : nn(input.color),
        pinned: input.pinned,
        position: input.position,
      },
    });
    return ok(res, note, "Nota atualizada");
  })
);

router.delete(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const cur = await prisma.workspaceNote.findFirst({ where: { id: req.params.id, userId: req.user!.id }, select: { id: true } });
    if (!cur) throw new NotFoundError("Nota não encontrada");
    await prisma.workspaceNote.delete({ where: { id: cur.id } });
    return ok(res, { id: cur.id }, "Nota removida");
  })
);

// ============================ PLANNER SEMANAL ============================

router.get(
  "/planner",
  asyncHandler(async (req, res) => {
    const raw = req.query.weekOf ? new Date(String(req.query.weekOf)) : new Date();
    const weekOf = mondayOf(Number.isNaN(raw.getTime()) ? new Date() : raw);
    const items = await prisma.plannerItem.findMany({
      where: { userId: req.user!.id, weekOf },
      orderBy: [{ weekday: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    });
    return ok(res, { weekOf: weekOf.toISOString().slice(0, 10), items });
  })
);

router.post(
  "/planner",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weekday: z.number().int().min(0).max(6),
        text: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    const weekOf = mondayOf(new Date(`${input.weekOf}T00:00:00Z`));
    const max = await prisma.plannerItem.aggregate({
      where: { userId: req.user!.id, weekOf, weekday: input.weekday },
      _max: { position: true },
    });
    const item = await prisma.plannerItem.create({
      data: {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        weekOf,
        weekday: input.weekday,
        text: input.text,
        position: (max._max.position ?? 0) + 1,
      },
    });
    return ok(res, item, "Item adicionado");
  })
);

router.patch(
  "/planner/:id",
  asyncHandler(async (req, res) => {
    const cur = await prisma.plannerItem.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!cur) throw new NotFoundError("Item não encontrado");
    const input = z
      .object({
        text: z.string().trim().min(1).max(500).optional(),
        done: z.boolean().optional(),
        weekday: z.number().int().min(0).max(6).optional(),
        position: z.number().int().optional(),
      })
      .parse(req.body);
    const item = await prisma.plannerItem.update({ where: { id: cur.id }, data: input });
    return ok(res, item, "Item atualizado");
  })
);

router.delete(
  "/planner/:id",
  asyncHandler(async (req, res) => {
    const cur = await prisma.plannerItem.findFirst({ where: { id: req.params.id, userId: req.user!.id }, select: { id: true } });
    if (!cur) throw new NotFoundError("Item não encontrado");
    await prisma.plannerItem.delete({ where: { id: cur.id } });
    return ok(res, { id: cur.id }, "Item removido");
  })
);

export default router;
