/**
 * Pasta técnica do projeto: /api/production/projects/:projectId/tech-folder
 *
 *   GET            dados (pranchas, especificação que sairá, títulos sugeridos)
 *   PUT            ordem, textos das pranchas e opções
 *   POST /sheets   envia imagem ou PDF do Promob (cada página vira uma prancha)
 *   DELETE /sheets/:sheetId
 *   GET  /sheets/:sheetId/file   o arquivo da prancha
 *   POST /drawings            desenha uma vista cotada a partir das medidas
 *   PUT  /drawings/:sheetId   refaz o desenho com medidas novas
 *   GET/PUT/DELETE /sheets/:sheetId/overlay   anotações por cima da prancha
 *   GET  /sheets/:sheetId/ai-brief   o móvel em dados + a instrução para a IA
 *   POST /sheets/:sheetId/ai-image   a IA gera a imagem 3D a partir da vista cotada
 *   GET  /sheets/:sheetId/preview.pdf   só esta prancha, já com o carimbo
 *   GET  .pdf      gera a pasta
 *   POST /publish  guarda nos documentos do projeto (Projeto técnico)
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { uploadDocument } from "../../middlewares/upload";
import { prisma } from "../../prisma";
import { buildStorageKey, storage } from "../../lib/storage";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storeGeneratedPdf } from "../docgen/docgen.service";
import { techFolderPdf } from "./tech-folder.pdf";
import { drawingPdf } from "./tech-drawing.pdf";
import { ApiError } from "../../utils/ApiError";
import { hitLimit, type RateStore } from "../../utils/rate-limit";
import { AiProviderError } from "../ai/provider";
import { imageProvider } from "../ai/provider/image";
import { MAX_AI_EXTRA_CHARS, TECH_AI_VIEWS, techAiBrief, techAiPrompt } from "./tech-ai.rules";
import { COLUMN_KINDS, DRAWING_FINISHES, DRAWING_LAYOUTS, DrawingError, type DrawingImage, type DrawingSpec } from "./tech-drawing.rules";
import { SCALES, SHEET_AREA, SHEET_TITLES, pngFromDataUrl, specBlocks, titleFromFile, type TechFolderData, type TechSheet } from "./tech-folder.rules";

const router = Router();
router.use(authenticate);

const key = (projectId: string) => `tech-folder.${projectId}`;
const MAX_SHEETS = 60;

async function projectFor(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true, code: true, name: true, organizationId: true,
      client: { select: { id: true, name: true } },
      // a especificação vem do orçamento aprovado; sem aprovação, do mais recente
      quotes: {
        where: { kind: "PADRAO" },
        orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 1,
        select: { number: true, status: true, items: { orderBy: { position: "asc" }, select: { room: true, description: true, corpo: true, porta: true, puxador: true, complemento: true, modelo: true } } },
      },
    },
  });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}

async function load(projectId: string): Promise<TechFolderData> {
  const row = await prisma.setting.findUnique({ where: { key: key(projectId) } });
  try {
    const v = JSON.parse(row?.value ?? "") as TechFolderData;
    return { sheets: Array.isArray(v.sheets) ? v.sheets : [], includeSpecs: v.includeSpecs !== false, notes: Array.isArray(v.notes) ? v.notes : [] };
  } catch {
    return { sheets: [], includeSpecs: true, notes: [] };
  }
}

async function save(projectId: string, data: TechFolderData) {
  const value = JSON.stringify(data);
  await prisma.setting.upsert({ where: { key: key(projectId) }, create: { key: key(projectId), value }, update: { value } });
}

function view(p: Awaited<ReturnType<typeof projectFor>>, data: TechFolderData) {
  const quote = p.quotes[0] ?? null;
  const specs = specBlocks(quote?.items ?? []);
  const rooms = [...new Set([...specs.map((s) => s.room), ...(quote?.items ?? []).map((i) => i.room?.trim()).filter((r): r is string => Boolean(r))])];
  // a tela só precisa saber se a prancha tem anotação, não onde o arquivo está
  const sheets = data.sheets.map((s) => ({ ...s, overlay: undefined, annotated: Boolean(s.overlay) }));
  return { ...data, sheets, specs, rooms, quote: quote ? { number: quote.number, status: quote.status } : null, titles: SHEET_TITLES, scales: SCALES, area: SHEET_AREA, ai: { image: imageProvider().enabled } };
}

router.get(
  "/projects/:projectId/tech-folder",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    return ok(res, view(p, await load(p.id)));
  })
);

const sheetInput = z.object({
  id: z.string(),
  room: z.string().trim().min(1, "Informe o ambiente da prancha").max(80),
  title: z.string().trim().min(1, "Informe o título da prancha").max(60),
  scale: z.string().trim().max(12).nullable().optional(),
  note: z.string().trim().max(120).nullable().optional(),
  stamp: z.boolean().optional(),
});

router.put(
  "/projects/:projectId/tech-folder",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const input = z.object({ sheets: z.array(sheetInput).max(MAX_SHEETS), includeSpecs: z.boolean().default(true), notes: z.array(z.string().trim().max(150)).max(4).default([]) }).parse(req.body);
    const cur = await load(p.id);
    const byId = new Map(cur.sheets.map((s) => [s.id, s]));
    // a ordem enviada é a ordem da pasta; o arquivo de cada prancha não muda por aqui
    const sheets = input.sheets.flatMap((s) => {
      const old = byId.get(s.id);
      return old ? [{ ...old, room: s.room, title: s.title, scale: s.scale || null, note: s.note || null, stamp: s.stamp ?? old.stamp }] : [];
    });
    if (sheets.length !== cur.sheets.length) throw new BadRequestError("A lista de pranchas mudou em outra tela. Recarregue e tente de novo.");
    const data = { sheets, includeSpecs: input.includeSpecs, notes: input.notes.filter(Boolean) };
    await save(p.id, data);
    return ok(res, view(p, data), "Pasta técnica salva");
  })
);

router.post(
  "/projects/:projectId/tech-folder/sheets",
  requirePermission("organization.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    const mime = req.file.mimetype;
    const isPdf = mime === "application/pdf";
    if (!isPdf && !/^image\/(png|jpe?g)$/i.test(mime)) throw new BadRequestError("Envie imagem PNG ou JPG, ou o PDF exportado do Promob.");
    const body = z.object({ room: z.string().trim().max(80).optional(), stamp: z.enum(["true", "false"]).optional() }).parse(req.body ?? {});
    const cur = await load(p.id);
    let pages = 1;
    if (isPdf) {
      try {
        pages = (await PDFDocument.load(req.file.buffer, { ignoreEncryption: true })).getPageCount();
      } catch {
        throw new BadRequestError("Não consegui abrir este PDF. Exporte de novo do Promob ou envie as imagens.");
      }
    }
    if (cur.sheets.length + pages > MAX_SHEETS) throw new BadRequestError(`A pasta aceita até ${MAX_SHEETS} pranchas.`);
    const storageKey = buildStorageKey(`${p.id}/pasta-tecnica`, req.file.originalname);
    await storage.put(storageKey, req.file.buffer, mime);
    const room = body.room || view(p, cur).rooms[0] || p.name;
    const added: TechSheet[] = Array.from({ length: pages }, (_, i) => ({
      id: randomUUID(),
      room,
      title: isPdf && pages > 1 ? `PRANCHA ${cur.sheets.length + i + 1}` : titleFromFile(req.file!.originalname, cur.sheets.length + i),
      scale: null,
      note: null,
      storageKey,
      fileName: req.file!.originalname,
      mime,
      page: isPdf ? i : null,
      // PDF do Promob costuma vir com o carimbo pronto; imagem solta recebe o da loja
      stamp: body.stamp ? body.stamp === "true" : !isPdf,
    }));
    const data = { ...cur, sheets: [...cur.sheets, ...added] };
    await save(p.id, data);
    return ok(res, view(p, data), pages > 1 ? `${pages} pranchas adicionadas` : "Prancha adicionada");
  })
);

// ---- prancha desenhada pelo sistema a partir das medidas
const mmNum = z.coerce.number().min(0).max(20_000);
const imageRef = z.object({ storageKey: z.string().max(400), fileName: z.string().max(200), mime: z.string().regex(/^image\/(png|jpe?g)$/i) });
/** Só vale imagem enviada para a pasta técnica deste projeto — a chave vem da tela. */
function ownImage(i: DrawingImage | null | undefined, projectId: string): DrawingImage | null {
  if (!i) return null;
  if (!i.storageKey.startsWith(`projects/${projectId}/pasta-tecnica/`) || i.storageKey.includes("..")) throw new BadRequestError("Imagem inválida. Envie de novo.");
  return i;
}

const drawingInput = z.object({
  room: z.string().trim().min(1, "Informe o ambiente").max(80),
  title: z.string().trim().min(1, "Informe o título da prancha").max(60),
  scale: z.string().trim().max(12).nullable().optional(),
  spec: z.object({
    description: z.string().trim().max(160).default(""),
    width: mmNum.positive("Informe a largura"),
    height: mmNum.positive("Informe a altura"),
    depth: mmNum.nullable().optional(),
    top: mmNum.default(0),
    base: mmNum.default(0),
    sideLeft: mmNum.max(1000).optional(),
    sideRight: mmNum.max(1000).optional(),
    columns: z
      .array(
        z.object({
          kind: z.enum(COLUMN_KINDS),
          width: mmNum.nullable().optional(),
          count: z.coerce.number().int().min(0).max(30).default(0),
          heights: z.array(mmNum.positive()).max(31).default([]),
          label: z.string().trim().max(24).nullable().optional(),
          shelves: z.coerce.number().int().min(0).max(30).optional(),
          note: z.string().trim().max(200).nullable().optional(),
        })
      )
      .min(1, "Adicione pelo menos uma coluna")
      .max(8),
    layout: z.enum(DRAWING_LAYOUTS).default("VISTA"),
    thickness: mmNum.max(100).optional(),
    finish: z.enum(DRAWING_FINISHES).optional(),
    shelfDepth: mmNum.nullable().optional(),
    specs: z.array(z.string().trim().max(90)).max(10).optional(),
    images: z.object({ closed: imageRef.nullable().optional(), open: imageRef.nullable().optional() }).optional(),
  }),
});

/** Desenha de novo a prancha de uma especificação já guardada (ex.: depois que a IA trocou a imagem). */
async function redrawSpec(spec: DrawingSpec, title: string, projectId: string) {
  const bytes = async (i: DrawingImage | null | undefined) => (i ? { bytes: await storage.getBytes(i.storageKey), mime: i.mime } : null);
  const out = await drawingPdf(spec, { closed: await bytes(spec.images?.closed), open: await bytes(spec.images?.open) });
  const fileName = `desenho-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vista"}.pdf`;
  const storageKey = buildStorageKey(`${projectId}/pasta-tecnica`, fileName);
  await storage.put(storageKey, out.pdf, "application/pdf");
  return { storageKey, fileName };
}

async function renderDrawing(input: z.infer<typeof drawingInput>, projectId: string) {
  const spec: DrawingSpec = {
    ...input.spec,
    depth: input.spec.depth || null,
    layout: "VISTA",
    shelfDepth: input.spec.shelfDepth || null,
    images: { closed: ownImage(input.spec.images?.closed, projectId), open: ownImage(input.spec.images?.open, projectId) },
    specs: (input.spec.specs ?? []).filter(Boolean),
    columns: input.spec.columns.map((c) => ({ kind: c.kind, width: c.width || null, count: c.count, heights: c.heights, label: c.label || null, shelves: c.shelves || 0, note: c.note || null })),
  };
  let out: Awaited<ReturnType<typeof drawingPdf>>;
  try {
    const bytes = async (i: DrawingImage | null | undefined) => (i ? { bytes: await storage.getBytes(i.storageKey), mime: i.mime } : null);
    out = await drawingPdf(spec, { closed: await bytes(spec.images?.closed), open: await bytes(spec.images?.open) });
  } catch (e) {
    if (e instanceof DrawingError) throw new BadRequestError(e.message);
    throw e;
  }
  const fileName = `desenho-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vista"}.pdf`;
  const storageKey = buildStorageKey(`${projectId}/pasta-tecnica`, fileName);
  await storage.put(storageKey, out.pdf, "application/pdf");
  return { spec, storageKey, fileName, warnings: out.warnings };
}

// imagem 3D (render) para a prancha completa: guarda o arquivo e devolve a referência
router.post(
  "/projects/:projectId/tech-folder/drawing-images",
  requirePermission("organization.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    if (!req.file) throw new BadRequestError("Arquivo é obrigatório");
    if (!/^image\/(png|jpe?g)$/i.test(req.file.mimetype)) throw new BadRequestError("Envie a imagem 3D em PNG ou JPG.");
    const storageKey = buildStorageKey(`${p.id}/pasta-tecnica`, req.file.originalname);
    await storage.put(storageKey, req.file.buffer, req.file.mimetype);
    return ok(res, { storageKey, fileName: req.file.originalname, mime: req.file.mimetype }, "Imagem enviada");
  })
);

router.post(
  "/projects/:projectId/tech-folder/drawings",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const input = drawingInput.parse(req.body);
    const cur = await load(p.id);
    if (cur.sheets.length + 1 > MAX_SHEETS) throw new BadRequestError(`A pasta aceita até ${MAX_SHEETS} pranchas.`);
    const d = await renderDrawing(input, p.id);
    const sheet: TechSheet = { id: randomUUID(), room: input.room, title: input.title, scale: input.scale || null, note: null, storageKey: d.storageKey, fileName: d.fileName, mime: "application/pdf", page: 0, stamp: true, drawing: d.spec };
    const data = { ...cur, sheets: [...cur.sheets, sheet] };
    await save(p.id, data);
    return ok(res, { ...view(p, data), sheetId: sheet.id, warnings: d.warnings }, "Desenho adicionado à pasta técnica");
  })
);

router.put(
  "/projects/:projectId/tech-folder/drawings/:sheetId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const input = drawingInput.parse(req.body);
    const cur = await load(p.id);
    const old = cur.sheets.find((s) => s.id === req.params.sheetId);
    if (!old?.drawing) throw new NotFoundError("Desenho não encontrado");
    const d = await renderDrawing(input, p.id);
    const sheets = cur.sheets.map((s) => (s.id === old.id ? { ...s, room: input.room, title: input.title, scale: input.scale || null, storageKey: d.storageKey, fileName: d.fileName, drawing: d.spec } : s));
    await save(p.id, { ...cur, sheets });
    await storage.remove(old.storageKey).catch(() => undefined);
    return ok(res, { ...view(p, { ...cur, sheets }), sheetId: old.id, warnings: d.warnings }, "Desenho atualizado");
  })
);

router.delete(
  "/projects/:projectId/tech-folder/sheets/:sheetId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const cur = await load(p.id);
    const target = cur.sheets.find((s) => s.id === req.params.sheetId);
    if (!target) throw new NotFoundError("Prancha não encontrada");
    const sheets = cur.sheets.filter((s) => s.id !== target.id);
    await save(p.id, { ...cur, sheets });
    // o arquivo só sai quando nenhuma outra prancha (outra página do mesmo PDF) usa
    if (!sheets.some((s) => s.storageKey === target.storageKey)) await storage.remove(target.storageKey).catch(() => undefined);
    if (target.overlay) await storage.remove(target.overlay.storageKey).catch(() => undefined);
    // as imagens 3D da prancha completa saem junto
    for (const img of [target.drawing?.images?.closed, target.drawing?.images?.open]) if (img) await storage.remove(img.storageKey).catch(() => undefined);
    return ok(res, view(p, { ...cur, sheets }), "Prancha removida");
  })
);

router.get(
  "/projects/:projectId/tech-folder/sheets/:sheetId/file",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const s = (await load(p.id)).sheets.find((x) => x.id === req.params.sheetId);
    if (!s) throw new NotFoundError("Prancha não encontrada");
    res.setHeader("Content-Type", s.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(await storage.getBytes(s.storageKey));
  })
);

// ---- IA no projeto técnico: imagem 3D gerada a partir da vista cotada
/** Cada imagem custa uma chamada paga de geração de imagem. */
const AI_LIMIT = { windowMs: 60 * 60_000, max: 20 };
const aiStore: RateStore = new Map();

router.get(
  "/projects/:projectId/tech-folder/sheets/:sheetId/ai-brief",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const s = (await load(p.id)).sheets.find((x) => x.id === req.params.sheetId);
    if (!s?.drawing) throw new NotFoundError("Esta prancha não foi desenhada por medidas");
    const ctx = { client: p.client.name, room: s.room };
    return ok(res, { configured: imageProvider().enabled, brief: techAiBrief(s.drawing, ctx), prompts: { FECHADO: techAiPrompt(s.drawing, ctx, "FECHADO"), ABERTO: techAiPrompt(s.drawing, ctx, "ABERTO") } });
  })
);

// A tela manda a vista cotada já como imagem (o servidor não converte PDF em imagem).
router.post(
  "/projects/:projectId/tech-folder/sheets/:sheetId/ai-image",
  requirePermission("organization.manage"),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const body = z.object({ slot: z.enum(["closed", "open"]).default("closed"), view: z.enum(TECH_AI_VIEWS).default("FECHADO"), extra: z.string().trim().max(MAX_AI_EXTRA_CHARS).optional() }).parse(req.body ?? {});
    if (!imageProvider().enabled) throw new BadRequestError("A IA de imagem ainda não está configurada neste ambiente (falta a chave GEMINI_API_KEY). Enquanto isso, envie a imagem 3D pelo botão de escolher imagem.");
    if (!req.file || !/^image\/(png|jpe?g)$/i.test(req.file.mimetype)) throw new BadRequestError("Não recebi a vista cotada para enviar à IA. Tente de novo.");
    const cur = await load(p.id);
    const old = cur.sheets.find((s) => s.id === req.params.sheetId);
    if (!old?.drawing) throw new NotFoundError("Esta prancha não foi desenhada por medidas");

    const limit = hitLimit(aiStore, `tech-ai:${req.user!.id}`, AI_LIMIT);
    if (!limit.allowed) throw new ApiError(429, `Limite de imagens por hora atingido. Tente de novo em ${Math.ceil(limit.retryAfterSec / 60)} minutos.`, undefined, "RATE_LIMITED");

    const started = Date.now();
    let out;
    try {
      out = await imageProvider().render({ bytes: req.file.buffer, mime: req.file.mimetype, prompt: techAiPrompt(old.drawing, { client: p.client.name, room: old.room }, body.view, body.extra) });
    } catch (e) {
      if (e instanceof AiProviderError) {
        console.warn("[projeto-tecnico-ia] provider error", JSON.stringify({ status: e.status ?? null, detail: e.detail ?? e.message }));
        throw new ApiError(e.status === 429 ? 429 : 502, e.status === 429 ? "A IA está com muitas solicitações agora. Tente de novo em instantes." : `Não consegui gerar a imagem: ${e.status ? "a IA recusou ou falhou" : e.message}.`, undefined, e.status === 429 ? "RATE_LIMITED" : "EXTERNAL_SERVICE_ERROR");
      }
      throw e;
    }
    console.info("[projeto-tecnico-ia] image generated", JSON.stringify({ project: p.code, ms: Date.now() - started, view: body.view }));

    // só PNG e JPG entram no PDF
    if (!/^image\/(png|jpe?g)$/i.test(out.mime)) throw new ApiError(502, "A IA devolveu a imagem em um formato que a prancha não aceita. Tente de novo.", undefined, "EXTERNAL_SERVICE_ERROR");
    const imageKey = buildStorageKey(`${p.id}/pasta-tecnica`, `ia-${body.view.toLowerCase()}.${/png/i.test(out.mime) ? "png" : "jpg"}`);
    await storage.put(imageKey, out.bytes, out.mime);
    const previous = old.drawing.images?.[body.slot] ?? null;
    const spec: DrawingSpec = { ...old.drawing, images: { ...old.drawing.images, [body.slot]: { storageKey: imageKey, fileName: `Imagem gerada por IA (${body.view === "ABERTO" ? "aberto" : "fechado"})`, mime: out.mime } } };
    const d = await redrawSpec(spec, old.title, p.id);
    const sheets = cur.sheets.map((s) => (s.id === old.id ? { ...s, storageKey: d.storageKey, fileName: d.fileName, drawing: spec } : s));
    await save(p.id, { ...cur, sheets });
    await storage.remove(old.storageKey).catch(() => undefined);
    if (previous) await storage.remove(previous.storageKey).catch(() => undefined);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "TECH_AI_IMAGE_GENERATED", entity: "Project", entityId: p.id, details: { sheetId: old.id, view: body.view } } });
    return ok(res, { ...view(p, { ...cur, sheets }), sheetId: old.id }, "Imagem 3D gerada pela IA e colocada na prancha");
  })
);

// ---- anotações por cima da prancha (desenho à mão e texto)
router.get(
  "/projects/:projectId/tech-folder/sheets/:sheetId/overlay",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const s = (await load(p.id)).sheets.find((x) => x.id === req.params.sheetId);
    if (!s?.overlay) throw new NotFoundError("Esta prancha não tem anotações");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(await storage.getBytes(s.overlay.storageKey));
  })
);

router.put(
  "/projects/:projectId/tech-folder/sheets/:sheetId/overlay",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const { dataUrl } = z.object({ dataUrl: z.string().max(4_500_000) }).parse(req.body);
    const png = pngFromDataUrl(dataUrl);
    if (!png) throw new BadRequestError("Anotação inválida. Tente salvar de novo.");
    const cur = await load(p.id);
    const old = cur.sheets.find((s) => s.id === req.params.sheetId);
    if (!old) throw new NotFoundError("Prancha não encontrada");
    const storageKey = buildStorageKey(`${p.id}/pasta-tecnica`, `anotacao-${old.id}.png`);
    await storage.put(storageKey, png, "image/png");
    const data = { ...cur, sheets: cur.sheets.map((s) => (s.id === old.id ? { ...s, overlay: { storageKey } } : s)) };
    await save(p.id, data);
    if (old.overlay) await storage.remove(old.overlay.storageKey).catch(() => undefined);
    return ok(res, view(p, data), "Anotações salvas na prancha");
  })
);

router.delete(
  "/projects/:projectId/tech-folder/sheets/:sheetId/overlay",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const cur = await load(p.id);
    const old = cur.sheets.find((s) => s.id === req.params.sheetId);
    if (!old) throw new NotFoundError("Prancha não encontrada");
    const data = { ...cur, sheets: cur.sheets.map((s) => (s.id === old.id ? { ...s, overlay: null } : s)) };
    await save(p.id, data);
    if (old.overlay) await storage.remove(old.overlay.storageKey).catch(() => undefined);
    return ok(res, view(p, data), "Anotações removidas");
  })
);

// Uma prancha só, do jeito que sai na pasta (carimbo, título e escala) — para conferir sem gerar tudo.
router.get(
  "/projects/:projectId/tech-folder/sheets/:sheetId/preview.pdf",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const s = (await load(p.id)).sheets.find((x) => x.id === req.params.sheetId);
    if (!s) throw new NotFoundError("Prancha não encontrada");
    const full = await techFolderPdf({
      client: p.client.name,
      project: { code: p.code, name: p.name },
      sheets: [{ ...s, bytes: await storage.getBytes(s.storageKey), overlayBytes: s.overlay ? await storage.getBytes(s.overlay.storageKey).catch(() => null) : null }],
      specs: [],
      notes: [],
      issuedAt: new Date(),
      hideSheetNumber: true,
    });
    // a primeira página é a capa: aqui interessa só a prancha
    const doc = await PDFDocument.load(full);
    doc.removePage(0);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="prancha-${p.code}.pdf"`);
    return res.send(Buffer.from(await doc.save()));
  })
);

async function pdfFor(projectId: string, organizationId: string) {
  const p = await projectFor(projectId, organizationId);
  const data = await load(p.id);
  const specs = data.includeSpecs ? specBlocks(p.quotes[0]?.items ?? []) : [];
  if (!data.sheets.length && !specs.length) throw new BadRequestError("A pasta ainda está vazia: envie as pranchas do Promob ou preencha os acabamentos no orçamento.");
  const files = new Map<string, Buffer>();
  for (const s of data.sheets) if (!files.has(s.storageKey)) files.set(s.storageKey, await storage.getBytes(s.storageKey));
  const pdf = await techFolderPdf({
    client: p.client.name,
    project: { code: p.code, name: p.name },
    sheets: await Promise.all(data.sheets.map(async (s) => ({ ...s, bytes: files.get(s.storageKey)!, overlayBytes: s.overlay ? await storage.getBytes(s.overlay.storageKey).catch(() => null) : null }))),
    specs,
    notes: data.notes,
    issuedAt: new Date(),
  });
  return { p, pdf };
}

router.get(
  "/projects/:projectId/tech-folder.pdf",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const { p, pdf } = await pdfFor(req.params.projectId, req.user!.organizationId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="pasta-tecnica-${p.code}.pdf"`);
    return res.send(pdf);
  })
);

router.post(
  "/projects/:projectId/tech-folder/publish",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const { p, pdf } = await pdfFor(req.params.projectId, req.user!.organizationId);
    const generatedFrom = `TechFolder:${p.id}`;
    const previous = await prisma.projectDocument.findFirst({ where: { projectId: p.id, type: "PROJETO_TECNICO", generatedFrom }, orderBy: { version: "desc" }, select: { id: true } });
    const doc = await storeGeneratedPdf({
      organizationId: p.organizationId,
      clientId: p.client.id,
      projectId: p.id,
      type: "PROJETO_TECNICO",
      generatedFrom,
      title: `Pasta técnica — ${p.code}`,
      fileName: `pasta-tecnica-${p.code}.pdf`,
      buffer: pdf,
      // fica interna: vai para o cliente pela aprovação do projeto técnico
      visibleToClient: false,
      uploadedById: req.user!.id,
      replacesId: previous?.id ?? null,
    });
    return ok(res, { documentId: doc.id, version: doc.version }, `Pasta técnica salva nos documentos do projeto (versão ${doc.version})`);
  })
);

export default router;
