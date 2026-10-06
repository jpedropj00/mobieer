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
import { COLUMN_KINDS, DrawingError, type DrawingSpec } from "./tech-drawing.rules";
import { SCALES, SHEET_TITLES, specBlocks, titleFromFile, type TechFolderData, type TechSheet } from "./tech-folder.rules";

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
  return { ...data, specs, rooms, quote: quote ? { number: quote.number, status: quote.status } : null, titles: SHEET_TITLES, scales: SCALES };
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
    columns: z
      .array(
        z.object({
          kind: z.enum(COLUMN_KINDS),
          width: mmNum.nullable().optional(),
          count: z.coerce.number().int().min(0).max(30).default(0),
          heights: z.array(mmNum.positive()).max(31).default([]),
          label: z.string().trim().max(24).nullable().optional(),
        })
      )
      .min(1, "Adicione pelo menos uma coluna")
      .max(8),
  }),
});

async function renderDrawing(input: z.infer<typeof drawingInput>, projectId: string) {
  const spec: DrawingSpec = {
    ...input.spec,
    depth: input.spec.depth || null,
    columns: input.spec.columns.map((c) => ({ kind: c.kind, width: c.width || null, count: c.count, heights: c.heights, label: c.label || null })),
  };
  let out: Awaited<ReturnType<typeof drawingPdf>>;
  try {
    out = await drawingPdf(spec);
  } catch (e) {
    if (e instanceof DrawingError) throw new BadRequestError(e.message);
    throw e;
  }
  const fileName = `desenho-${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vista"}.pdf`;
  const storageKey = buildStorageKey(`${projectId}/pasta-tecnica`, fileName);
  await storage.put(storageKey, out.pdf, "application/pdf");
  return { spec, storageKey, fileName, warnings: out.warnings };
}

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
    sheets: data.sheets.map((s) => ({ ...s, bytes: files.get(s.storageKey)! })),
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
