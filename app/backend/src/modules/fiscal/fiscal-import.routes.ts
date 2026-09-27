/**
 * Notas da contabilidade, só para registro. A plataforma não emite nada aqui:
 * guarda o XML/PDF, lê os dados para a pessoa conferir e liga ao cliente.
 *
 *   POST /api/fiscal/import/preview  (multipart files[]: .xml)  -> o que seria registrado, sem gravar
 *   POST /api/fiscal/import          (multipart data, xml?, pdf?) -> registra uma nota (ou o cancelamento)
 */
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, ConflictError, UnsupportedFileTypeError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { buildStorageKey, storage } from "../../lib/storage";
import { buildInvoiceRef, fiscalInclude, serializeInvoice } from "./fiscal.service";
import { invoiceDirection, parseInvoiceXml, type ParsedXml } from "./fiscal.xml";

const router = Router();
router.use(authenticate);

// XML de nota tem dezenas de KB; o limite total fica abaixo do corpo máximo da Vercel.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 60 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xml|pdf)$/i.test(file.originalname)) cb(null, true);
    else cb(new UnsupportedFileTypeError("Envie o XML da nota (e, se quiser, o PDF/DANFE)"));
  },
});

const digits = (v: string | null | undefined) => (v ? v.replace(/\D/g, "") : "");

async function companyDocument(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { enterprise: { select: { document: true } } } });
  return org?.enterprise.document ?? null;
}

/** Clientes por CPF/CNPJ (só dígitos), para ligar a nota ao cliente certo. */
async function clientsByDocument(organizationId: string) {
  const rows = await prisma.client.findMany({ where: { organizationId, document: { not: null } }, select: { id: true, name: true, document: true } });
  return new Map(rows.map((c) => [digits(c.document), { id: c.id, name: c.name }]));
}

// POST /api/fiscal/import/preview
router.post(
  "/preview",
  requirePermission("finance.manage"),
  upload.array("files", 60),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const xmls = files.filter((f) => /\.xml$/i.test(f.originalname));
    if (!xmls.length) throw new BadRequestError("Envie pelo menos um XML");
    const orgId = req.user!.organizationId;
    const [ownDoc, clients] = await Promise.all([companyDocument(orgId), clientsByDocument(orgId)]);
    const parsed = xmls.map((f) => ({ fileName: f.originalname, result: parseInvoiceXml(f.buffer.toString("utf8")) as ParsedXml }));
    const keys = parsed.flatMap((p) => (p.result.type === "INVOICE" && p.result.invoice.accessKey ? [p.result.invoice.accessKey] : p.result.type === "CANCELLATION" ? [p.result.accessKey] : []));
    const existing = keys.length
      ? await prisma.fiscalInvoice.findMany({ where: { organizationId: orgId, accessKey: { in: keys } }, select: { id: true, accessKey: true, status: true, number: true } })
      : [];
    const byKey = new Map(existing.map((e) => [e.accessKey!, e]));

    const items = parsed.map(({ fileName, result }) => {
      if (result.type === "UNKNOWN") return { fileName, type: "UNKNOWN" as const, reason: result.reason };
      if (result.type === "CANCELLATION") {
        const hit = byKey.get(result.accessKey);
        return {
          fileName,
          type: "CANCELLATION" as const,
          accessKey: result.accessKey,
          reason: result.reason,
          target: hit ? { id: hit.id, number: hit.number, alreadyCancelled: hit.status === "CANCELLED" } : null,
        };
      }
      const inv = result.invoice;
      const direction = invoiceDirection(inv, ownDoc);
      // a outra parte: destinatário quando a empresa emitiu, emitente quando recebeu
      const other = direction === "ENTRADA" ? inv.issuer : inv.recipient;
      const client = other.document ? clients.get(other.document) ?? null : null;
      return {
        fileName,
        type: "INVOICE" as const,
        invoice: inv,
        direction,
        counterpart: other,
        client,
        duplicate: inv.accessKey ? Boolean(byKey.get(inv.accessKey)) : false,
        warnings: result.warnings,
      };
    });
    return ok(res, { companyDocument: ownDoc, items });
  })
);

const dataSchema = z.object({
  kind: z.enum(["NFE", "NFSE"]),
  direction: z.enum(["SAIDA", "ENTRADA"]),
  number: z.string().trim().max(30).optional().nullable(),
  series: z.string().trim().max(10).optional().nullable(),
  accessKey: z.string().trim().max(60).optional().nullable(),
  issuedAt: z.coerce.date(),
  amount: z.coerce.number().min(0).max(99_999_999),
  counterpartName: z.string().trim().max(200).optional().nullable(),
  counterpartDocument: z.string().trim().max(20).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
});

// POST /api/fiscal/import
router.post(
  "/",
  requirePermission("finance.manage"),
  upload.fields([
    { name: "xml", maxCount: 1 },
    { name: "pdf", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const orgId = req.user!.organizationId;
    const files = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
    const xml = files.xml?.[0];
    const pdf = files.pdf?.[0];

    // XML de cancelamento: marca a nota já registrada como cancelada.
    if (xml && !req.body.data) {
      const r = parseInvoiceXml(xml.buffer.toString("utf8"));
      if (r.type !== "CANCELLATION") throw new BadRequestError("Informe os dados da nota");
      const target = await prisma.fiscalInvoice.findFirst({ where: { organizationId: orgId, accessKey: r.accessKey } });
      if (!target) throw new BadRequestError("A nota deste cancelamento ainda não está registrada — registre a nota primeiro");
      if (target.status === "CANCELLED") return ok(res, { cancelled: true, id: target.id }, "Esta nota já estava cancelada");
      await prisma.fiscalInvoice.update({
        where: { id: target.id },
        data: { status: "CANCELLED", cancelledAt: r.at ? new Date(r.at) : new Date(), errorMessage: r.reason ? `Cancelada: ${r.reason}` : null },
      });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "FISCAL_INVOICE_CANCELLATION_IMPORTED", entity: "FiscalInvoice", entityId: target.id, details: { accessKey: r.accessKey } } });
      return ok(res, { cancelled: true, id: target.id }, `Nota ${target.number ?? ""} marcada como cancelada`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(String(req.body.data ?? ""));
    } catch {
      throw new BadRequestError("Dados da nota inválidos");
    }
    const input = dataSchema.parse(raw);
    if (!xml && !pdf) throw new BadRequestError("Anexe o XML ou o PDF da nota");

    if (input.projectId) {
      const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: orgId }, select: { clientId: true } });
      if (!p) throw new BadRequestError("Projeto inválido");
      input.clientId = input.clientId || p.clientId;
    }
    if (input.clientId && !(await prisma.client.findFirst({ where: { id: input.clientId, organizationId: orgId }, select: { id: true } }))) {
      throw new BadRequestError("Cliente inválido");
    }
    if (input.accessKey && (await prisma.fiscalInvoice.findFirst({ where: { organizationId: orgId, accessKey: input.accessKey }, select: { id: true } }))) {
      throw new ConflictError("Esta nota já está registrada");
    }

    const ref = buildInvoiceRef(orgId);
    const put = async (f: Express.Multer.File | undefined, ext: "xml" | "pdf") => {
      if (!f) return null;
      const key = buildStorageKey(`fiscal/${orgId}`, `${input.accessKey || ref}.${ext}`);
      await storage.put(key, f.buffer, ext === "xml" ? "application/xml" : "application/pdf");
      return key;
    };
    const [xmlKey, pdfKey] = await Promise.all([put(xml, "xml"), put(pdf, "pdf")]);
    try {
      const inv = await prisma.fiscalInvoice.create({
        data: {
          organizationId: orgId,
          kind: input.kind,
          status: "ISSUED",
          source: "CONTABILIDADE",
          direction: input.direction,
          ref,
          provider: null,
          providerRef: input.accessKey || null,
          accessKey: input.accessKey || null,
          number: input.number || null,
          series: input.series || null,
          amount: new Prisma.Decimal(input.amount.toFixed(2)),
          description: input.description || null,
          counterpartName: input.counterpartName || null,
          counterpartDocument: digits(input.counterpartDocument) || null,
          issuedAt: input.issuedAt,
          xmlKey,
          pdfKey,
          clientId: input.clientId || null,
          projectId: input.projectId || null,
          createdById: req.user!.id,
        },
        include: fiscalInclude,
      });
      await prisma.auditLog.create({ data: { userId: req.user!.id, action: "FISCAL_INVOICE_IMPORTED", entity: "FiscalInvoice", entityId: inv.id, details: { number: inv.number, accessKey: inv.accessKey, direction: inv.direction } } });
      return ok(res, serializeInvoice(inv), `Nota ${inv.number ?? ""} registrada`);
    } catch (e) {
      await Promise.all([xmlKey && storage.remove(xmlKey), pdfKey && storage.remove(pdfKey)].map((p) => p && p.catch(() => undefined)));
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictError("Esta nota já está registrada");
      throw e;
    }
  })
);

export default router;
