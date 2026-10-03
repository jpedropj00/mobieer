/**
 * Render com IA do projeto: /api/production/projects/:projectId/renders
 *
 *   GET                    lista, sugestão de acabamentos por ambiente e se a IA está configurada
 *   POST                   imagem do Promob (ou `parentId` de um render para ajustar) → novo render
 *   GET  /:id/:which       arquivo (`source` ou `result`)
 *   POST /:id/publish      guarda o render nos documentos do projeto (Projeto 3D)
 *   DELETE /:id
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { buildStorageKey, storage } from "../../lib/storage";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError, BadRequestError, NotFoundError } from "../../utils/ApiError";
import { hitLimit, type RateStore } from "../../utils/rate-limit";
import { ok } from "../../utils/response";
import { AiProviderError } from "../ai/provider";
import { imageProvider } from "../ai/provider/image";
import { quoteRooms } from "../commercial/quote.rules";
import { LIGHTING_LABEL, MAX_FINISHES_CHARS, MAX_RENDERS_PER_PROJECT, finishesFromQuote, orphanKeys, renderPrompt, sortRenders, type RenderItem } from "./render.rules";

const router = Router();
router.use(authenticate);

const key = (projectId: string) => `renders.${projectId}`;
/** Cada render custa uma chamada paga de geração de imagem. */
const LIMIT = { windowMs: 60 * 60_000, max: 20 };
const store: RateStore = new Map();

async function projectFor(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true, code: true, name: true, organizationId: true,
      client: { select: { id: true } },
      quotes: {
        where: { kind: "PADRAO" },
        orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 1,
        select: { items: { orderBy: { position: "asc" }, select: { room: true, description: true, corpo: true, porta: true, puxador: true, complemento: true, modelo: true } } },
      },
    },
  });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

async function load(projectId: string): Promise<RenderItem[]> {
  const row = await prisma.setting.findUnique({ where: { key: key(projectId) } });
  try {
    const v = JSON.parse(row?.value ?? "[]") as RenderItem[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function save(projectId: string, items: RenderItem[]) {
  const value = JSON.stringify(items);
  await prisma.setting.upsert({ where: { key: key(projectId) }, create: { key: key(projectId), value }, update: { value } });
}

const view = (r: RenderItem) => ({ id: r.id, room: r.room, finishes: r.finishes, lighting: r.lighting, adjustment: r.adjustment, parentId: r.parentId, createdAt: r.createdAt, createdBy: r.createdBy });

router.get(
  "/projects/:projectId/renders",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const items = p.quotes[0]?.items ?? [];
    const rooms = quoteRooms(items);
    return ok(res, {
      enabled: imageProvider().enabled,
      renders: sortRenders(await load(p.id)).map(view),
      rooms: rooms.map((room) => ({ room, finishes: finishesFromQuote(items, room) })),
      lighting: LIGHTING_LABEL,
    });
  })
);

const input = z.object({
  room: z.string().trim().min(1, "Informe o ambiente").max(80),
  finishes: z.string().trim().max(MAX_FINISHES_CHARS).default(""),
  lighting: z.enum(["DIA", "NOITE", "ESTUDIO"]).default("DIA"),
  adjustment: z.string().trim().max(600).optional(),
  parentId: z.string().max(60).optional(),
});

router.post(
  "/projects/:projectId/renders",
  requirePermission("organization.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    if (!imageProvider().enabled) throw new ApiError(503, "O render com IA ainda não está configurado.", undefined, "SERVICE_UNAVAILABLE");
    const body = input.parse(req.body ?? {});
    const items = await load(p.id);
    if (items.length >= MAX_RENDERS_PER_PROJECT) throw new BadRequestError(`Este projeto já tem ${MAX_RENDERS_PER_PROJECT} renders. Remova os que não servem antes de gerar outro.`);

    // a base é a imagem enviada agora, ou o resultado de um render anterior (ajuste)
    const parent = body.parentId ? items.find((r) => r.id === body.parentId) : null;
    if (body.parentId && !parent) throw new NotFoundError("Render de base não encontrado");
    let base: { bytes: Buffer; mime: string; sourceKey: string | null };
    if (parent) {
      if (!body.adjustment) throw new BadRequestError("Descreva o ajuste que você quer neste render.");
      base = { bytes: await storage.getBytes(parent.resultKey), mime: parent.resultMime, sourceKey: parent.resultKey };
    } else {
      if (!req.file) throw new BadRequestError("Envie a imagem do ambiente exportada do Promob.");
      if (!/^image\/(png|jpe?g|webp)$/i.test(req.file.mimetype)) throw new BadRequestError("Envie uma imagem PNG, JPG ou WEBP.");
      base = { bytes: req.file.buffer, mime: req.file.mimetype, sourceKey: null };
    }

    const limit = hitLimit(store, `render:${req.user!.id}`, LIMIT);
    if (!limit.allowed) throw new ApiError(429, `Limite de renders por hora atingido. Tente de novo em ${Math.ceil(limit.retryAfterSec / 60)} minutos.`, undefined, "RATE_LIMITED");

    const started = Date.now();
    let out;
    try {
      out = await imageProvider().render({ bytes: base.bytes, mime: base.mime, prompt: renderPrompt({ room: body.room, finishes: body.finishes, lighting: body.lighting, adjustment: parent ? body.adjustment : null }) });
    } catch (e) {
      if (e instanceof AiProviderError) {
        console.warn("[render-ia] provider error", JSON.stringify({ status: e.status ?? null, detail: e.detail ?? e.message }));
        throw new ApiError(e.status === 429 ? 429 : 502, e.status === 429 ? "A IA está com muitas solicitações agora. Tente de novo em instantes." : `Não consegui gerar o render: ${e.status ? "a IA recusou ou falhou" : e.message}.`, undefined, e.status === 429 ? "RATE_LIMITED" : "EXTERNAL_SERVICE_ERROR");
      }
      throw e;
    }
    console.info("[render-ia] render generated", JSON.stringify({ project: p.code, ms: Date.now() - started, adjust: Boolean(parent) }));

    const sourceKey = base.sourceKey ?? buildStorageKey(`${p.id}/render`, `origem-${req.file!.originalname}`);
    if (!base.sourceKey) await storage.put(sourceKey, base.bytes, base.mime);
    const ext = /jpe?g/i.test(out.mime) ? "jpg" : /webp/i.test(out.mime) ? "webp" : "png";
    const resultKey = buildStorageKey(`${p.id}/render`, `render-${body.room}.${ext}`);
    await storage.put(resultKey, out.bytes, out.mime);

    const item: RenderItem = {
      id: randomUUID(),
      room: body.room,
      finishes: body.finishes,
      lighting: body.lighting,
      adjustment: parent ? body.adjustment ?? null : null,
      sourceKey,
      sourceMime: base.mime,
      resultKey,
      resultMime: out.mime,
      parentId: parent?.id ?? null,
      createdAt: new Date().toISOString(),
      createdBy: req.user!.name,
    };
    await save(p.id, [...items, item]);
    return ok(res, view(item), "Render gerado");
  })
);

router.get(
  "/projects/:projectId/renders/:id/:which",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const r = (await load(p.id)).find((x) => x.id === req.params.id);
    if (!r || !["source", "result"].includes(req.params.which)) throw new NotFoundError("Render não encontrado");
    const source = req.params.which === "source";
    res.setHeader("Content-Type", source ? r.sourceMime : r.resultMime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.send(await storage.getBytes(source ? r.sourceKey : r.resultKey));
  })
);

router.post(
  "/projects/:projectId/renders/:id/publish",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const r = (await load(p.id)).find((x) => x.id === req.params.id);
    if (!r) throw new NotFoundError("Render não encontrado");
    const { visibleToClient } = z.object({ visibleToClient: z.boolean().default(false) }).parse(req.body ?? {});
    const ext = /jpe?g/i.test(r.resultMime) ? "jpg" : /webp/i.test(r.resultMime) ? "webp" : "png";
    const bytes = await storage.getBytes(r.resultKey);
    const fileName = `render-${r.room.replace(/[^\w\-]+/g, "_")}.${ext}`;
    const storageKey = buildStorageKey(p.id, fileName);
    await storage.put(storageKey, bytes, r.resultMime);
    const doc = await prisma.projectDocument.create({
      data: { organizationId: p.organizationId, projectId: p.id, clientId: p.client.id, type: "PROJETO_3D", title: `Render — ${r.room}`, description: "Imagem ilustrativa gerada com IA a partir do projeto.", storageKey, fileName, mimeType: r.resultMime, sizeBytes: bytes.length, visibleToClient, uploadedById: req.user!.id },
      select: { id: true },
    });
    return ok(res, { documentId: doc.id }, visibleToClient ? "Render salvo nos documentos e visível no portal do cliente" : "Render salvo nos documentos do projeto");
  })
);

router.delete(
  "/projects/:projectId/renders/:id",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const items = await load(p.id);
    const target = items.find((x) => x.id === req.params.id);
    if (!target) throw new NotFoundError("Render não encontrado");
    const remaining = items.filter((x) => x.id !== target.id);
    await save(p.id, remaining);
    for (const k of orphanKeys(remaining, target)) await storage.remove(k).catch(() => undefined);
    return ok(res, { removed: true }, "Render removido");
  })
);

export default router;
