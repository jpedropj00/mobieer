/**
 * Termo de entrega do projeto: /api/production/projects/:projectId/delivery-term
 *
 *   GET            dados salvos (ou a sugestão a partir do orçamento)
 *   PUT            salva o preenchimento
 *   GET  .pdf      confere o PDF
 *   POST /publish  guarda nos documentos do projeto, visível ao cliente e
 *                  pedindo a assinatura da loja e do cliente
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { storeGeneratedPdf } from "../docgen/docgen.service";
import { deliveryTermPdf } from "./delivery-term.pdf";
import { roomsFromQuote, type DeliveryTermData } from "./delivery-term.rules";

const router = Router();
router.use(authenticate);

const key = (projectId: string) => `delivery-term.${projectId}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const input = z.object({
  contractNumber: z.string().trim().max(40).default(""),
  rooms: z.array(z.object({ date: day, room: z.string().trim().min(1, "Informe o ambiente").max(80) })).max(40),
  deadlines: z.array(z.object({ label: z.string().trim().max(60), date: day.nullable() })).max(6),
  deliveryDays: z.coerce.number().int().min(1).max(365).default(45),
  city: z.string().trim().max(60).default("Fortaleza"),
  date: day,
});

async function projectFor(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({
    where: { id, organizationId },
    select: {
      id: true, code: true, name: true, organizationId: true,
      client: { select: { id: true, name: true, document: true, city: true } },
      quotes: {
        where: { kind: "PADRAO" },
        orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 1,
        select: { number: true, deliveryDays: true, items: { orderBy: { position: "asc" }, select: { room: true } } },
      },
    },
  });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
type P = Awaited<ReturnType<typeof projectFor>>;

function suggestion(p: P): DeliveryTermData {
  const quote = p.quotes[0];
  return {
    contractNumber: quote?.number ?? p.code,
    rooms: roomsFromQuote(quote?.items ?? [], today()),
    deadlines: [{ label: "Prazo de entrega do material", date: null }],
    deliveryDays: quote?.deliveryDays ?? 45,
    city: p.client.city?.trim() || "Fortaleza",
    date: today(),
  };
}

async function load(p: P): Promise<{ saved: boolean; data: DeliveryTermData }> {
  const row = await prisma.setting.findUnique({ where: { key: key(p.id) } });
  try {
    return { saved: true, data: input.parse(JSON.parse(row?.value ?? "")) as DeliveryTermData };
  } catch {
    return { saved: false, data: suggestion(p) };
  }
}

const pdfOf = (p: P, data: DeliveryTermData) => deliveryTermPdf({ ...data, client: { name: p.client.name, document: p.client.document } });

/** O termo publicado mais recente, para a tela mostrar em que pé está a assinatura. */
async function published(projectId: string) {
  return prisma.projectDocument.findFirst({
    where: { projectId, generatedFrom: `DeliveryTerm:${projectId}` },
    orderBy: { version: "desc" },
    select: { id: true, version: true, signatureStatus: true, createdAt: true, signatures: { select: { role: true, signerName: true, signedAt: true } } },
  });
}

router.get(
  "/projects/:projectId/delivery-term",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    return ok(res, { ...(await load(p)), client: { name: p.client.name, document: p.client.document }, document: await published(p.id) });
  })
);

router.put(
  "/projects/:projectId/delivery-term",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const data = input.parse(req.body) as DeliveryTermData;
    const value = JSON.stringify(data);
    await prisma.setting.upsert({ where: { key: key(p.id) }, create: { key: key(p.id), value }, update: { value } });
    return ok(res, { saved: true, data }, "Termo salvo");
  })
);

router.get(
  "/projects/:projectId/delivery-term.pdf",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const pdf = await pdfOf(p, (await load(p)).data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="termo-de-entrega-${p.code}.pdf"`);
    return res.send(pdf);
  })
);

router.post(
  "/projects/:projectId/delivery-term/publish",
  requirePermission("documents.manage"),
  asyncHandler(async (req, res) => {
    const p = await projectFor(req.params.projectId, req.user!.organizationId);
    const pdf = await pdfOf(p, (await load(p)).data);
    const generatedFrom = `DeliveryTerm:${p.id}`;
    const previous = await prisma.projectDocument.findFirst({ where: { projectId: p.id, generatedFrom }, orderBy: { version: "desc" }, select: { id: true } });
    const doc = await storeGeneratedPdf({
      organizationId: p.organizationId,
      clientId: p.client.id,
      projectId: p.id,
      type: "TERMO_PRODUCAO",
      generatedFrom,
      title: `Termo de entrega — ${p.code}`,
      fileName: `termo-de-entrega-${p.code}.pdf`,
      buffer: pdf,
      // vai para o portal: o cliente lê e assina
      visibleToClient: true,
      uploadedById: req.user!.id,
      replacesId: previous?.id ?? null,
    });
    await prisma.projectDocument.update({ where: { id: doc.id }, data: { requiresSignature: true, signerRoles: ["MOBIEER", "CLIENTE"], signatureStatus: "PENDING" } });
    // a versão anterior sai da vista do cliente, para ele não assinar o termo antigo
    if (previous) await prisma.projectDocument.update({ where: { id: previous.id }, data: { visibleToClient: false } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "DELIVERY_TERM_PUBLISHED", entity: "ProjectDocument", entityId: doc.id, details: { projectId: p.id, version: doc.version } } });
    return ok(res, { documentId: doc.id, version: doc.version }, `Termo enviado ao portal do cliente (versão ${doc.version}). Falta a assinatura da loja e a do cliente.`);
  })
);

export default router;
