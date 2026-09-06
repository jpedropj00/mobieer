import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { env } from "../../config/env";
import { NfeError, NfeNotConfiguredError, cancelInvoice, getInvoice, issueInvoice, nfeEnabled } from "../../lib/nfe";
import { storage } from "../../lib/storage";
import { buildInvoiceRef, fiscalInclude, serializeInvoice } from "./fiscal.service";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function ensureInvoice(id: string, organizationId: string) {
  const inv = await prisma.fiscalInvoice.findFirst({ where: { id, organizationId }, include: fiscalInclude });
  if (!inv) throw new NotFoundError("Nota não encontrada");
  return inv;
}

// GET /api/fiscal/config  -> a UI usa para saber se pode emitir
router.get(
  "/config",
  requirePermission("finance.read"),
  asyncHandler(async (_req, res) => {
    return ok(res, {
      configured: nfeEnabled(),
      provider: env.nfe.provider,
      environment: env.nfe.environment,
    });
  })
);

// GET /api/fiscal?status=&projectId=
router.get(
  "/",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.fiscalInvoice.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.status ? { status: req.query.status as never } : {}),
        ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      },
      include: fiscalInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, rows.map(serializeInvoice));
  })
);

router.get(
  "/:id",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    return ok(res, serializeInvoice(inv));
  })
);

// GET /api/fiscal/:id/file/:kind  (xml|pdf)
router.get(
  "/:id/file/:kind",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    const kind = req.params.kind === "xml" ? "xml" : "pdf";
    const key = kind === "xml" ? inv.xmlKey : inv.pdfKey;
    if (!key) throw new NotFoundError("Arquivo não disponível");
    const signed = await storage.getSignedUrl(key, `${inv.ref}.${kind}`);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(key);
    res.setHeader("Content-Type", kind === "xml" ? "application/xml" : "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.ref}.${kind}"`);
    stream.pipe(res);
  })
);

// POST /api/fiscal  -> cria rascunho
router.post(
  "/",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        kind: z.enum(["NFE", "NFSE"]).default("NFE"),
        projectId: z.string().min(1).optional().nullable(),
        clientId: z.string().min(1).optional().nullable(),
        amount: z.coerce.number().positive().max(99_999_999),
        description: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);

    if (input.projectId) {
      const p = await prisma.project.findFirst({ where: { id: input.projectId, organizationId: req.user!.organizationId }, select: { id: true, clientId: true } });
      if (!p) throw new BadRequestError("Projeto inválido");
      if (!input.clientId) input.clientId = p.clientId;
    }
    if (input.clientId) {
      const c = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: req.user!.organizationId }, select: { id: true } });
      if (!c) throw new BadRequestError("Cliente inválido");
    }

    const inv = await prisma.fiscalInvoice.create({
      data: {
        organizationId: req.user!.organizationId,
        kind: input.kind,
        status: "DRAFT",
        ref: buildInvoiceRef(req.user!.organizationId),
        provider: env.nfe.provider,
        amount: new Prisma.Decimal(input.amount),
        description: nn(input.description),
        projectId: input.projectId ?? null,
        clientId: input.clientId ?? null,
        createdById: req.user!.id,
      },
      include: fiscalInclude,
    });
    return ok(res, serializeInvoice(inv), "Rascunho de nota criado");
  })
);

// POST /api/fiscal/:id/issue  -> envia ao provedor (ou marca ERROR se não configurado)
router.post(
  "/:id/issue",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    if (inv.status === "ISSUED") throw new BadRequestError("Esta nota já foi emitida");
    if (inv.status === "PROCESSING" || inv.status === "QUEUED") throw new BadRequestError("Emissão já em andamento");

    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { enterprise: { select: { legalName: true, tradeName: true, cnae: true, uf: true, municipio: true, regimeTributario: true } } },
    });

    // Payload mínimo; o provedor valida o restante conforme o cadastro fiscal dele.
    const payload = {
      ref: inv.ref,
      natureza_operacao: "Venda de mercadoria",
      data_emissao: new Date().toISOString(),
      tipo_documento: 1,
      valor_total: Number(inv.amount),
      informacoes_adicionais_contribuinte: inv.description ?? undefined,
      emitente: {
        razao_social: org?.enterprise?.legalName ?? undefined,
        nome_fantasia: org?.enterprise?.tradeName ?? undefined,
        regime_tributario: org?.enterprise?.regimeTributario ?? undefined,
      },
      destinatario: inv.client
        ? { nome: inv.client.name, cpf_cnpj: inv.client.document ?? undefined }
        : undefined,
    };

    if (!nfeEnabled()) {
      const updated = await prisma.fiscalInvoice.update({
        where: { id: inv.id },
        data: {
          status: "ERROR",
          payloadJson: payload as unknown as Prisma.InputJsonValue,
          errorMessage: new NfeNotConfiguredError().message,
        },
        include: fiscalInclude,
      });
      return ok(res, serializeInvoice(updated), "Provedor de NF-e não configurado — nada foi enviado à SEFAZ");
    }

    try {
      const result = await issueInvoice(inv.ref, payload);
      const statusMap: Record<string, string> = {
        autorizado: "ISSUED",
        processando_autorizacao: "PROCESSING",
        erro_autorizacao: "REJECTED",
        denegado: "REJECTED",
        cancelado: "CANCELLED",
      };
      const updated = await prisma.fiscalInvoice.update({
        where: { id: inv.id },
        data: {
          status: (statusMap[result.status] ?? "PROCESSING") as never,
          providerRef: result.providerRef ?? undefined,
          number: result.number ?? undefined,
          payloadJson: payload as unknown as Prisma.InputJsonValue,
          resultJson: result.raw as unknown as Prisma.InputJsonValue,
          errorMessage: result.message ?? null,
          issuedAt: statusMap[result.status] === "ISSUED" ? new Date() : undefined,
        },
        include: fiscalInclude,
      });
      return ok(res, serializeInvoice(updated), "Nota enviada ao provedor");
    } catch (e) {
      if (!(e instanceof NfeError)) throw e;
      const updated = await prisma.fiscalInvoice.update({
        where: { id: inv.id },
        data: { status: "ERROR", payloadJson: payload as unknown as Prisma.InputJsonValue, errorMessage: e.message },
        include: fiscalInclude,
      });
      return ok(res, serializeInvoice(updated), "Falha ao comunicar com o provedor");
    }
  })
);

// POST /api/fiscal/:id/refresh  -> consulta o status no provedor
router.post(
  "/:id/refresh",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    if (!nfeEnabled()) throw new BadRequestError(new NfeNotConfiguredError().message);
    const result = await getInvoice(inv.ref);
    const statusMap: Record<string, string> = {
      autorizado: "ISSUED",
      processando_autorizacao: "PROCESSING",
      erro_autorizacao: "REJECTED",
      denegado: "REJECTED",
      cancelado: "CANCELLED",
    };
    const updated = await prisma.fiscalInvoice.update({
      where: { id: inv.id },
      data: {
        status: (statusMap[result.status] ?? inv.status) as never,
        providerRef: result.providerRef ?? undefined,
        number: result.number ?? undefined,
        resultJson: result.raw as unknown as Prisma.InputJsonValue,
        errorMessage: result.message ?? null,
        issuedAt: statusMap[result.status] === "ISSUED" && !inv.issuedAt ? new Date() : undefined,
      },
      include: fiscalInclude,
    });
    return ok(res, serializeInvoice(updated), "Status atualizado");
  })
);

// POST /api/fiscal/:id/cancel  { justificativa }
router.post(
  "/:id/cancel",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    const { justificativa } = z.object({ justificativa: z.string().trim().min(15).max(255) }).parse(req.body);
    if (inv.status === "DRAFT" || inv.status === "ERROR") {
      const updated = await prisma.fiscalInvoice.update({
        where: { id: inv.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
        include: fiscalInclude,
      });
      return ok(res, serializeInvoice(updated), "Rascunho cancelado");
    }
    if (!nfeEnabled()) throw new BadRequestError(new NfeNotConfiguredError().message);
    const result = await cancelInvoice(inv.ref, justificativa);
    const updated = await prisma.fiscalInvoice.update({
      where: { id: inv.id },
      data: {
        status: result.status === "cancelado" ? "CANCELLED" : (inv.status as never),
        resultJson: result.raw as unknown as Prisma.InputJsonValue,
        errorMessage: result.message ?? null,
        cancelledAt: result.status === "cancelado" ? new Date() : undefined,
      },
      include: fiscalInclude,
    });
    return ok(res, serializeInvoice(updated), "Pedido de cancelamento enviado");
  })
);

// DELETE /api/fiscal/:id  -> remove rascunho/erro
router.delete(
  "/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const inv = await ensureInvoice(req.params.id, req.user!.organizationId);
    if (!["DRAFT", "ERROR", "REJECTED", "CANCELLED"].includes(inv.status)) {
      throw new BadRequestError("Só é possível remover notas em rascunho, com erro ou canceladas");
    }
    await prisma.fiscalInvoice.delete({ where: { id: inv.id } });
    return ok(res, { id: inv.id }, "Nota removida");
  })
);

export default router;
