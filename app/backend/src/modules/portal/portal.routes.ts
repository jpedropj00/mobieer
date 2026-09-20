import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { authenticateClient, authenticatePortalAccount, signPortalToken } from "../../middlewares/portalAuth";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { sendMail, renderResetEmail } from "../../lib/mailer";
import { storage, buildStorageKey } from "../../lib/storage";
import { uploadPhoto } from "../../middlewares/upload";
import { recomputeSignatureStatus } from "../documents/documents.routes";
import { APPLIANCE_CATEGORIES, getOrCreateSheet, serializeItem, serializeSheet } from "../appliances/appliances.service";
import { MEASUREMENT_PERIODS, serializeVisit, visitInclude } from "../measurements/measurements.service";
import { approvalInclude, getOrCreateApproval, serializeApproval } from "../techproject/techproject.service";
import {
  getOrCreateOrder as getOrCreateProductionOrder,
  orderInclude as productionInclude,
  serializeOrder as serializeProductionOrder,
} from "../production/production.service";
import { pipeToResponse } from "../../utils/stream";
import {
  ASSISTANCE_PROBLEM_TYPES,
  MAX_ASSISTANCE_PHOTOS_ON_OPEN,
  MIN_ASSISTANCE_DESCRIPTION,
  MIN_ASSISTANCE_PHOTOS,
  validateAssistanceRequest,
  confirmVisit,
  onAssistanceOpenedByClient,
  requestReschedule,
  scheduleSelect,
  scheduleVisit,
  serializeSchedule,
} from "../assistance/assistance.service";
import { deliveryEstimateFor } from "../production/leadtime.service";
import { briefingAnswersSchema, briefingForLead, saveBriefing } from "../briefing/briefing.service";
import { isValidCpf, onlyDigits } from "../../utils/document";
import { rateLimit } from "../../utils/rate-limit";
import { ConflictError, ForbiddenError } from "../../utils/ApiError";

const router = Router();

const passwordSchema = z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(100);

async function companyNameForAccount(account: { clientId: string | null; leadId: string | null }) {
  const orgSelect = { select: { name: true, enterprise: { select: { tradeName: true, legalName: true } } } } as const;
  const org = account.clientId
    ? (await prisma.client.findUnique({ where: { id: account.clientId }, select: { organization: orgSelect } }))?.organization
    : account.leadId
      ? (await prisma.commercialLead.findUnique({ where: { id: account.leadId }, select: { organization: orgSelect } }))?.organization
      : null;
  return org?.enterprise.tradeName || org?.enterprise.legalName || org?.name || "MOBIEER";
}

function portalLink(pathname: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return `${env.appUrl}${env.portal.path}${pathname}${qs ? `?${qs}` : ""}`;
}

// ============================================================
// AUTENTICAÇÃO (sem token)
// ============================================================

router.post(
  "/auth/login",
  rateLimit({ name: "portal-login", windowMs: 15 * 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    const account = await prisma.clientAccount.findUnique({
      where: { email: email.toLowerCase() },
      include: { client: { select: { id: true, name: true, status: true } } },
    });

    if (!account || !account.passwordHash || account.status !== "ACTIVE") {
      throw new UnauthorizedError("Credenciais inválidas");
    }
    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) throw new UnauthorizedError("Credenciais inválidas");
    if (account.client && account.client.status !== "ACTIVE") throw new UnauthorizedError("Cadastro do cliente inativo");

    await prisma.clientAccount.update({ where: { id: account.id }, data: { lastLogin: new Date() } });

    return ok(res, {
      token: signPortalToken(account.id),
      level: account.accessLevel,
      account: { id: account.id, name: account.name, email: account.email },
      client: account.client ? { id: account.client.id, name: account.client.name } : null,
    });
  })
);

// Valida um token de convite e devolve os dados para a tela de definição de senha
router.get(
  "/auth/invite/:token",
  asyncHandler(async (req, res) => {
    const account = await prisma.clientAccount.findUnique({ where: { inviteToken: req.params.token } });
    if (!account || account.status === "DISABLED" || !account.inviteExpiry || account.inviteExpiry < new Date()) {
      throw new BadRequestError("Convite inválido ou expirado");
    }
    return ok(res, { name: account.name, email: account.email });
  })
);

// Define a senha a partir de um convite e já autentica
router.post(
  "/auth/accept-invite",
  asyncHandler(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(req.body);
    const account = await prisma.clientAccount.findUnique({ where: { inviteToken: token } });
    if (!account || account.status === "DISABLED" || !account.inviteExpiry || account.inviteExpiry < new Date()) {
      throw new BadRequestError("Convite inválido ou expirado");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await prisma.clientAccount.update({
      where: { id: account.id },
      data: { passwordHash, status: "ACTIVE", inviteToken: null, inviteExpiry: null, lastLogin: new Date() },
    });
    return ok(res, {
      token: signPortalToken(updated.id),
      level: updated.accessLevel,
      account: { id: updated.id, name: updated.name, email: updated.email },
    });
  })
);

router.post(
  "/auth/forgot",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const account = await prisma.clientAccount.findUnique({ where: { email: email.toLowerCase() } });
    if (account && account.status === "ACTIVE") {
      const resetToken = crypto.randomBytes(32).toString("hex");
      await prisma.clientAccount.update({
        where: { id: account.id },
        data: { resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const companyName = await companyNameForAccount(account);
      const mail = renderResetEmail({
        name: account.name,
        companyName,
        link: portalLink("/redefinir-senha", { token: resetToken }),
      });
      await sendMail({ to: account.email, ...mail });
    }
    return ok(res, { requested: true });
  })
);

router.post(
  "/auth/reset",
  asyncHandler(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(req.body);
    const account = await prisma.clientAccount.findUnique({ where: { resetToken: token } });
    if (!account || !account.resetTokenExpiry || account.resetTokenExpiry < new Date()) {
      throw new BadRequestError("Token inválido ou expirado");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.clientAccount.update({
      where: { id: account.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });
    return ok(res, { reset: true });
  })
);

// POST /api/portal/auth/signup { name, email, cpf, password }
// Cadastro curto pelo site: vira lead com acesso só ao briefing.
router.post(
  "/auth/signup",
  rateLimit({ name: "portal-signup", windowMs: 60 * 60 * 1000, max: 10 }),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(3, "Informe o nome completo").max(200),
        email: z.string().trim().toLowerCase().email("E-mail inválido"),
        cpf: z.string().trim().min(11).max(20),
        password: passwordSchema,
        // campo invisível no formulário: robô preenche, pessoa não
        website: z.string().max(0).optional(),
      })
      .parse(req.body);

    const cpf = onlyDigits(input.cpf);
    if (!isValidCpf(cpf)) throw new BadRequestError("CPF inválido", { field: "cpf" }, "VALIDATION_ERROR");

    const [emailTaken, cpfTaken] = await Promise.all([
      prisma.clientAccount.findUnique({ where: { email: input.email }, select: { id: true } }),
      prisma.clientAccount.findUnique({ where: { document: cpf }, select: { id: true } }),
    ]);
    if (emailTaken) throw new ConflictError("Já existe um acesso com este e-mail. Entre com sua senha ou use \"Esqueci a senha\".", { field: "email" }, "DUPLICATE");
    if (cpfTaken) throw new ConflictError("Já existe um acesso com este CPF. Entre com seu e-mail e senha.", { field: "cpf" }, "DUPLICATE");

    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!org) throw new BadRequestError("Organização não configurada");

    const passwordHash = await bcrypt.hash(input.password, 12);
    const account = await prisma.$transaction(async (tx) => {
      const lead = await tx.commercialLead.create({
        data: { organizationId: org.id, name: input.name, email: input.email, document: cpf, source: "Site", status: "NEW" },
      });
      return tx.clientAccount.create({
        data: {
          leadId: lead.id,
          accessLevel: "BRIEFING",
          document: cpf,
          name: input.name,
          email: input.email,
          passwordHash,
          status: "ACTIVE",
          lastLogin: new Date(),
        },
      });
    });
    await prisma.auditLog.create({
      data: { action: "PORTAL_SIGNUP", entity: "ClientAccount", entityId: account.id, details: { leadId: account.leadId } },
    });

    return ok(
      res,
      { token: signPortalToken(account.id), level: account.accessLevel, account: { id: account.id, name: account.name, email: account.email }, client: null },
      "Cadastro criado. Agora responda o briefing."
    );
  })
);

// ============================================================
// SESSÃO E BRIEFING (qualquer conta ativa, inclusive só-briefing)
// ============================================================

// GET /api/portal/session -> quem é e o que pode acessar
router.get(
  "/session",
  authenticatePortalAccount,
  asyncHandler(async (req, res) => {
    const a = req.portalAccount!;
    const lead = a.leadId
      ? await prisma.commercialLead.findUnique({ where: { id: a.leadId }, select: { status: true, briefing: { select: { submittedAt: true } } } })
      : null;
    return ok(res, {
      account: { id: a.accountId, name: a.name, email: a.email },
      level: a.level,
      hasClient: Boolean(a.clientId),
      briefing: a.leadId ? { submittedAt: lead?.briefing?.submittedAt ?? null, leadStatus: lead?.status ?? null } : null,
    });
  })
);

// GET /api/portal/briefing
router.get(
  "/briefing",
  authenticatePortalAccount,
  asyncHandler(async (req, res) => {
    const a = req.portalAccount!;
    if (!a.leadId) throw new NotFoundError("Não há briefing ligado a este acesso");
    return ok(res, await briefingForLead(a.leadId));
  })
);

// PUT /api/portal/briefing
router.put(
  "/briefing",
  authenticatePortalAccount,
  asyncHandler(async (req, res) => {
    const a = req.portalAccount!;
    if (!a.leadId) throw new ForbiddenError("Não há briefing ligado a este acesso");
    const input = briefingAnswersSchema.parse(req.body);
    const { firstTime } = await saveBriefing(a.leadId, input);
    return ok(
      res,
      await briefingForLead(a.leadId),
      firstTime ? "Briefing enviado! Nossa equipe vai entrar em contato." : "Respostas atualizadas"
    );
  })
);

// ============================================================
// DADOS DO CLIENTE (cadastro completo)
// ============================================================

router.use(authenticateClient);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const client = await prisma.client.findUnique({
      where: { id: req.portal!.clientId },
      select: { id: true, name: true, email: true, phone: true },
    });
    return ok(res, { account: req.portal, client });
  })
);

router.get(
  "/projects",
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: { clientId: req.portal!.clientId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        startAt: true,
        dueAt: true,
        completedAt: true,
        manager: { select: { name: true } },
        _count: { select: { documents: { where: { visibleToClient: true } }, assistances: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return ok(res, projects);
  })
);

router.get(
  "/projects/:id",
  asyncHandler(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, clientId: req.portal!.clientId },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        status: true,
        startAt: true,
        dueAt: true,
        completedAt: true,
        feedbackFormUrl: true,
        manager: { select: { name: true } },
        technicalApproval: { select: { status: true, approvedAt: true } },
        productionOrder: { select: { stage: true, estimatedDeliveryAt: true, deliveredAt: true } },
        assistances: {
          select: {
            ...scheduleSelect,
            priority: true,
            createdAt: true,
            resolvedAt: true,
            origin: true,
            problemType: true,
            roomLabel: true,
            description: true,
            attachments: { select: { id: true, fileName: true, mimeType: true, createdAt: true }, orderBy: { createdAt: "asc" } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!project) throw new NotFoundError("Projeto não encontrado");

    const docs = await prisma.projectDocument.findMany({
      where: {
        clientId: req.portal!.clientId,
        visibleToClient: true,
        OR: [{ projectId: project.id }, { projectId: null }],
      },
      select: {
        id: true, type: true, title: true, description: true, fileName: true, mimeType: true, sizeBytes: true,
        version: true, createdAt: true, requiresSignature: true, signerRoles: true, signatureStatus: true,
        signatures: { select: { role: true, signerName: true, signedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const ta = project.technicalApproval;
    return ok(res, {
      ...project,
      technicalApproval: ta && ta.status !== "DRAFT" ? ta : null,
      productionOrder: undefined,
      production: project.productionOrder ?? null,
      feedbackFormUrl: project.feedbackFormUrl || env.clientFeedbackFormUrl || null,
      assistances: project.assistances.map((a) => ({
        id: a.id,
        number: a.number,
        title: a.title,
        status: a.status,
        priority: a.priority,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        origin: a.origin,
        problemType: a.problemType,
        roomLabel: a.roomLabel,
        description: a.description,
        attachments: a.attachments.map((att) => ({ ...att, downloadUrl: `/api/portal/assistances/${a.id}/attachments/${att.id}/download` })),
        schedule: serializeSchedule(a),
      })),
      documents: docs.map((d) => ({
        ...d,
        downloadUrl: `/api/portal/documents/${d.id}/download`,
        clientSigned: d.signatures.some((s) => s.role === "CLIENTE"),
        canClientSign: d.requiresSignature && d.signerRoles.includes("CLIENTE") && !d.signatures.some((s) => s.role === "CLIENTE"),
      })),
    });
  })
);

// POST /api/portal/documents/:id/sign  { signerName, dataUrl }  -> papel CLIENTE
router.post(
  "/documents/:id/sign",
  asyncHandler(async (req, res) => {
    const doc = await prisma.projectDocument.findFirst({
      where: { id: req.params.id, clientId: req.portal!.clientId, visibleToClient: true, requiresSignature: true },
      select: { id: true, signerRoles: true, requiresSignature: true },
    });
    if (!doc) throw new NotFoundError("Documento não encontrado ou não exige assinatura");
    if (!doc.signerRoles.includes("CLIENTE")) throw new BadRequestError("Este documento não prevê assinatura do cliente");

    const input = z
      .object({
        signerName: z.string().trim().min(2).max(160),
        dataUrl: z.string().startsWith("data:image/").max(2_000_000),
      })
      .parse(req.body);

    await prisma.documentSignature.upsert({
      where: { documentId_role: { documentId: doc.id, role: "CLIENTE" } },
      create: { documentId: doc.id, role: "CLIENTE", signerName: input.signerName, dataUrl: input.dataUrl, signedByClientAccountId: req.portal!.accountId, ip: req.ip ?? null },
      update: { signerName: input.signerName, dataUrl: input.dataUrl, signedByClientAccountId: req.portal!.accountId, signedAt: new Date() },
    });
    await recomputeSignatureStatus(doc.id);
    const updated = await prisma.projectDocument.findUnique({ where: { id: doc.id }, select: { signatureStatus: true } });
    return ok(res, { signatureStatus: updated?.signatureStatus }, "Assinatura registrada");
  })
);

router.get(
  "/documents/:id/download",
  asyncHandler(async (req, res) => {
    const doc = await prisma.projectDocument.findFirst({
      where: { id: req.params.id, clientId: req.portal!.clientId, visibleToClient: true },
    });
    if (!doc) throw new NotFoundError("Documento não encontrado");
    const signed = await storage.getSignedUrl(doc.storageKey, doc.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(doc.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

router.get(
  "/assistances",
  asyncHandler(async (req, res) => {
    const items = await prisma.assistanceTicket.findMany({
      where: { clientId: req.portal!.clientId },
      select: {
        ...scheduleSelect,
        description: true,
        problemType: true,
        roomLabel: true,
        priority: true,
        origin: true,
        createdAt: true,
        resolvedAt: true,
        project: { select: { id: true, code: true, name: true } },
        attachments: { select: { id: true, fileName: true, mimeType: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      res,
      items.map((a) => ({
        id: a.id,
        number: a.number,
        title: a.title,
        description: a.description,
        problemType: a.problemType,
        roomLabel: a.roomLabel,
        status: a.status,
        priority: a.priority,
        origin: a.origin,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        project: a.project,
        attachments: a.attachments.map((att) => ({ ...att, downloadUrl: `/api/portal/assistances/${a.id}/attachments/${att.id}/download` })),
        schedule: serializeSchedule(a),
      }))
    );
  })
);

// POST /api/portal/assistances/:id/attachments  (multipart: photo)  -> cliente anexa foto
router.post(
  "/assistances/:id/attachments",
  uploadPhoto.single("photo"),
  asyncHandler(async (req, res) => {
    const ticket = await prisma.assistanceTicket.findFirst({
      where: { id: req.params.id, clientId: req.portal!.clientId },
      select: { id: true, _count: { select: { attachments: true } } },
    });
    if (!ticket) throw new NotFoundError("Chamado não encontrado");
    if (!req.file) throw new BadRequestError("Envie uma imagem");
    if (ticket._count.attachments >= 12) throw new BadRequestError("Limite de 12 fotos por chamado");

    const key = buildStorageKey(`assistances/${ticket.id}`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    const att = await prisma.assistanceAttachment.create({
      data: {
        ticketId: ticket.id,
        storageKey: key,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedByClientAccountId: req.portal!.accountId,
        uploadedByLabel: "Cliente",
      },
      select: { id: true, fileName: true, mimeType: true, createdAt: true },
    });
    return ok(res, { ...att, downloadUrl: `/api/portal/assistances/${ticket.id}/attachments/${att.id}/download` }, "Foto anexada");
  })
);

router.get(
  "/assistances/:id/attachments/:attId/download",
  asyncHandler(async (req, res) => {
    const att = await prisma.assistanceAttachment.findFirst({
      where: { id: req.params.attId, ticketId: req.params.id, ticket: { clientId: req.portal!.clientId } },
    });
    if (!att) throw new NotFoundError("Anexo não encontrado");
    const signed = await storage.getSignedUrl(att.storageKey, att.fileName);
    if (signed) return res.redirect(signed);
    const stream = await storage.getStream(att.storageKey);
    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.fileName)}"`);
    return pipeToResponse(stream, res);
  })
);

router.delete(
  "/assistances/:id/attachments/:attId",
  asyncHandler(async (req, res) => {
    const att = await prisma.assistanceAttachment.findFirst({
      where: { id: req.params.attId, ticketId: req.params.id, ticket: { clientId: req.portal!.clientId }, uploadedByClientAccountId: { not: null } },
      select: { id: true, storageKey: true },
    });
    if (!att) throw new NotFoundError("Anexo não encontrado");
    await storage.remove(att.storageKey).catch(() => undefined);
    await prisma.assistanceAttachment.delete({ where: { id: att.id } });
    return ok(res, { id: att.id }, "Foto removida");
  })
);

// ============================================================
// FICHA DE ELETRODOMÉSTICOS (cliente preenche)
// ============================================================

async function portalProject(projectId: string, clientId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, clientId },
    select: { id: true, organizationId: true, code: true, name: true, managerId: true },
  });
  if (!project) throw new NotFoundError("Projeto não encontrado");
  return project;
}

async function portalItem(itemId: string, clientId: string) {
  const item = await prisma.applianceItem.findFirst({
    where: { id: itemId, sheet: { project: { clientId } } },
    include: { sheet: { select: { id: true, status: true } } },
  });
  if (!item) throw new NotFoundError("Item não encontrado");
  if (item.sheet.status === "REVIEWED") throw new BadRequestError("A ficha já foi conferida pela equipe e está bloqueada para edição");
  return item;
}

const portalDim = z.coerce.number().min(0).max(9999).optional().nullable();
const portalNn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const portalDec = (v: number | null | undefined) => (v == null ? null : Number(v).toFixed(1));

router.get(
  "/projects/:id/appliance-sheet",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const sheet = await getOrCreateSheet(project.id, project.organizationId);
    const full = await prisma.applianceSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      include: {
        items: { orderBy: [{ position: "asc" }, { name: "asc" }] },
        project: { select: { id: true, code: true, name: true } },
      },
    });
    return ok(res, serializeSheet(full));
  })
);

router.patch(
  "/projects/:id/appliance-sheet",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const sheet = await getOrCreateSheet(project.id, project.organizationId);
    if (sheet.status === "REVIEWED") throw new BadRequestError("A ficha já foi conferida e está bloqueada");
    const input = z
      .object({
        ambientes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
        notes: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    await prisma.applianceSheet.update({
      where: { id: sheet.id },
      data: {
        ambientes: input.ambientes === undefined ? undefined : portalNn(input.ambientes),
        notes: input.notes === undefined ? undefined : portalNn(input.notes),
      },
    });
    const full = await prisma.applianceSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      include: { items: { orderBy: [{ position: "asc" }, { name: "asc" }] }, project: { select: { id: true, code: true, name: true } } },
    });
    return ok(res, serializeSheet(full), "Ficha atualizada");
  })
);

router.post(
  "/projects/:id/appliance-sheet/items",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const sheet = await getOrCreateSheet(project.id, project.organizationId);
    if (sheet.status === "REVIEWED") throw new BadRequestError("A ficha já foi conferida e está bloqueada");
    const input = z.object({ category: z.enum(APPLIANCE_CATEGORIES), name: z.string().trim().min(2).max(120) }).parse(req.body);
    const max = await prisma.applianceItem.aggregate({ where: { sheetId: sheet.id }, _max: { position: true } });
    const item = await prisma.applianceItem.create({
      data: { sheetId: sheet.id, category: input.category, name: input.name, custom: true, position: (max._max.position ?? 0) + 1 },
    });
    return ok(res, serializeItem(item), "Item adicionado");
  })
);

router.patch(
  "/appliance-items/:itemId",
  asyncHandler(async (req, res) => {
    const item = await portalItem(req.params.itemId, req.portal!.clientId);
    const input = z
      .object({
        owned: z.boolean().optional(),
        willBuy: z.boolean().optional(),
        brandModel: z.string().trim().max(200).optional().nullable().or(z.literal("")),
        widthCm: portalDim,
        heightCm: portalDim,
        depthCm: portalDim,
        referenceUrl: z.string().trim().max(500).optional().nullable().or(z.literal("")),
        notes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    const updated = await prisma.applianceItem.update({
      where: { id: item.id },
      data: {
        owned: input.owned,
        willBuy: input.willBuy,
        brandModel: input.brandModel === undefined ? undefined : portalNn(input.brandModel),
        widthCm: input.widthCm === undefined ? undefined : portalDec(input.widthCm),
        heightCm: input.heightCm === undefined ? undefined : portalDec(input.heightCm),
        depthCm: input.depthCm === undefined ? undefined : portalDec(input.depthCm),
        referenceUrl: input.referenceUrl === undefined ? undefined : portalNn(input.referenceUrl),
        notes: input.notes === undefined ? undefined : portalNn(input.notes),
      },
    });
    return ok(res, serializeItem(updated), "Item atualizado");
  })
);

router.delete(
  "/appliance-items/:itemId",
  asyncHandler(async (req, res) => {
    const item = await portalItem(req.params.itemId, req.portal!.clientId);
    if (!item.custom) throw new BadRequestError("Só é possível remover itens adicionados por você");
    await prisma.applianceItem.delete({ where: { id: item.id } });
    return ok(res, { id: item.id }, "Item removido");
  })
);

router.post(
  "/projects/:id/appliance-sheet/submit",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const sheet = await getOrCreateSheet(project.id, project.organizationId);
    if (sheet.status === "REVIEWED") throw new BadRequestError("A ficha já foi conferida");
    await prisma.applianceSheet.update({ where: { id: sheet.id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    if (project.managerId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          title: "Ficha de eletrodomésticos enviada",
          message: `${project.code} — ${project.name}: o cliente enviou a ficha de eletrodomésticos.`,
          userId: project.managerId,
        },
      });
    }
    return ok(res, { status: "SUBMITTED" }, "Ficha enviada. Obrigado!");
  })
);

// ============================================================
// AGENDAMENTO DA MEDIÇÃO (cliente solicita)
// ============================================================

router.get(
  "/projects/:id/measurement",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const visit = await prisma.measurementVisit.findFirst({
      where: { projectId: project.id },
      include: visitInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(res, visit ? serializeVisit(visit) : null);
  })
);

const measurementRequestSchema = z.object({
  preferredDates: z.array(z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(3),
  preferredPeriod: z.enum(MEASUREMENT_PERIODS).optional().nullable(),
  clientNotes: z.string().trim().max(2000).optional().nullable().or(z.literal("")),
});

router.post(
  "/projects/:id/measurement",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const open = await prisma.measurementVisit.findFirst({
      where: { projectId: project.id, status: { in: ["REQUESTED", "SCHEDULED"] } },
      select: { id: true },
    });
    if (open) throw new BadRequestError("Já existe uma solicitação de medição em andamento para este projeto");
    const input = measurementRequestSchema.parse(req.body);
    const visit = await prisma.measurementVisit.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        status: "REQUESTED",
        preferredDates: input.preferredDates,
        preferredPeriod: input.preferredPeriod ?? null,
        clientNotes: input.clientNotes?.trim() || null,
      },
      include: visitInclude,
    });
    if (project.managerId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          title: "Medição solicitada pelo cliente",
          message: `${project.code} — ${project.name}: o cliente solicitou a medição. Datas sugeridas: ${input.preferredDates.join(", ")}.`,
          userId: project.managerId,
        },
      });
    }
    return ok(res, serializeVisit(visit), "Solicitação enviada. A equipe vai confirmar a data.");
  })
);

router.patch(
  "/measurement/:id",
  asyncHandler(async (req, res) => {
    const visit = await prisma.measurementVisit.findFirst({
      where: { id: req.params.id, project: { clientId: req.portal!.clientId } },
      select: { id: true, status: true },
    });
    if (!visit) throw new NotFoundError("Medição não encontrada");
    if (visit.status !== "REQUESTED") throw new BadRequestError("A equipe já está tratando esta solicitação");
    const input = measurementRequestSchema.partial().parse(req.body);
    const updated = await prisma.measurementVisit.update({
      where: { id: visit.id },
      data: {
        preferredDates: input.preferredDates ?? undefined,
        preferredPeriod: input.preferredPeriod === undefined ? undefined : input.preferredPeriod ?? null,
        clientNotes: input.clientNotes === undefined ? undefined : input.clientNotes?.trim() || null,
      },
      include: visitInclude,
    });
    return ok(res, serializeVisit(updated), "Solicitação atualizada");
  })
);

// ============================================================
// APROVAÇÃO DO PROJETO TÉCNICO (cliente aprova / pede mudanças)
// ============================================================

router.get(
  "/projects/:id/tech-approval",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const approval = await prisma.technicalProjectApproval.findUnique({
      where: { projectId: project.id },
      include: approvalInclude,
    });
    if (!approval || approval.status === "DRAFT") return ok(res, null);
    return ok(res, serializeApproval(approval, { includeSignature: true }));
  })
);

router.post(
  "/projects/:id/tech-approval/approve",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const approval = await getOrCreateApproval(project.id, project.organizationId);
    if (approval.status === "DRAFT") throw new NotFoundError("Projeto técnico ainda não disponível");
    if (approval.status === "APPROVED") throw new BadRequestError("Este projeto técnico já foi aprovado");
    const input = z
      .object({
        approvedByName: z.string().trim().min(2).max(160),
        signatureDataUrl: z.string().startsWith("data:image/").max(2_000_000),
      })
      .parse(req.body);

    const updated = await prisma.technicalProjectApproval.update({
      where: { id: approval.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByName: input.approvedByName,
        signatureDataUrl: input.signatureDataUrl,
        signedByClientAccountId: req.portal!.accountId,
        clientComment: null,
      },
      include: approvalInclude,
    });
    // Aprovado -> entra na esteira de produção (etapa "liberado").
    await getOrCreateProductionOrder(project.id, project.organizationId);
    if (project.managerId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          title: "Projeto técnico aprovado",
          message: `${project.code} — ${project.name}: o cliente aprovou o projeto técnico. Liberado para produção.`,
          userId: project.managerId,
        },
      });
    }
    return ok(res, serializeApproval(updated, { includeSignature: true }), "Projeto técnico aprovado. Obrigado!");
  })
);

router.post(
  "/projects/:id/tech-approval/request-changes",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const approval = await getOrCreateApproval(project.id, project.organizationId);
    if (approval.status !== "IN_REVIEW") throw new BadRequestError("Não há projeto técnico aguardando sua avaliação");
    const input = z.object({ comment: z.string().trim().min(3).max(3000) }).parse(req.body);
    const updated = await prisma.technicalProjectApproval.update({
      where: { id: approval.id },
      data: { status: "CHANGES_REQUESTED", clientComment: input.comment },
      include: approvalInclude,
    });
    if (project.managerId) {
      await prisma.notification.create({
        data: {
          type: "INFO",
          title: "Projeto técnico — ajustes solicitados",
          message: `${project.code} — ${project.name}: o cliente pediu ajustes no projeto técnico.`,
          userId: project.managerId,
        },
      });
    }
    return ok(res, serializeApproval(updated, { includeSignature: true }), "Enviamos seu pedido de ajustes à equipe");
  })
);

// ============================================================
// ESTEIRA DE PRODUÇÃO (cliente acompanha)
// ============================================================

router.get(
  "/projects/:id/production",
  asyncHandler(async (req, res) => {
    const project = await portalProject(req.params.id, req.portal!.clientId);
    const order = await prisma.productionOrder.findUnique({
      where: { projectId: project.id },
      include: productionInclude,
    });
    if (!order) return ok(res, null);
    const deliveryEstimate = await deliveryEstimateFor(order);
    return ok(res, { ...serializeProductionOrder(order), deliveryEstimate });
  })
);

// POST /api/portal/assistances  (multipart: problemType, roomLabel, description, projectId?, photos[])
// Só o cliente abre assistência: com tipo do problema, ambiente, descrição detalhada e fotos.
router.post(
  "/assistances",
  uploadPhoto.array("photos", MAX_ASSISTANCE_PHOTOS_ON_OPEN + 1),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        problemType: z.string().trim().max(80).default(""),
        roomLabel: z.string().trim().max(120).default(""),
        description: z.string().max(10000).default(""),
        projectId: z.string().trim().min(1).optional().nullable().or(z.literal("")),
      })
      .parse(req.body ?? {});
    const photos = (req.files as Express.Multer.File[] | undefined) ?? [];

    const client = await prisma.client.findUnique({
      where: { id: req.portal!.clientId },
      select: { organizationId: true, _count: { select: { projects: true } } },
    });
    if (!client) throw new BadRequestError("Cliente inválido");

    const projectId = input.projectId || null;
    const valid = validateAssistanceRequest({
      problemType: input.problemType,
      roomLabel: input.roomLabel,
      description: input.description,
      photoCount: photos.length,
      projectId,
      clientHasProjects: client._count.projects > 0,
    });
    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, clientId: req.portal!.clientId }, select: { id: true } });
      if (!project) throw new BadRequestError("Projeto inválido");
    }

    // Fotos primeiro; se o registro falhar, elas são apagadas.
    const stored: { key: string; file: Express.Multer.File }[] = [];
    try {
      for (const file of photos) {
        const key = buildStorageKey(`assistances/${req.portal!.clientId}`, file.originalname);
        await storage.put(key, file.buffer, file.mimetype);
        stored.push({ key, file });
      }

      // número sequencial; em corrida rara (mesmo número), tenta de novo
      let ticket: { id: string; number: string; title: string; status: string; createdAt: Date } | null = null;
      for (let attempt = 0; attempt < 3 && !ticket; attempt++) {
        const count = await prisma.assistanceTicket.count({ where: { organizationId: client.organizationId } });
        const number = `AST-${String(count + 1 + attempt).padStart(5, "0")}`;
        try {
          ticket = await prisma.assistanceTicket.create({
            data: {
              number,
              organizationId: client.organizationId,
              clientId: req.portal!.clientId,
              projectId,
              title: valid.title,
              problemType: input.problemType,
              roomLabel: valid.roomLabel,
              description: valid.description,
              status: "OPEN",
              origin: "CLIENT_PORTAL",
              openedByClientAccountId: req.portal!.accountId,
              attachments: {
                create: stored.map(({ key, file }) => ({
                  storageKey: key,
                  fileName: file.originalname,
                  mimeType: file.mimetype,
                  sizeBytes: file.size,
                  uploadedByClientAccountId: req.portal!.accountId,
                  uploadedByLabel: "Cliente",
                })),
              },
            },
            select: { id: true, number: true, title: true, status: true, createdAt: true },
          });
        } catch (e) {
          if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e;
        }
      }

      await onAssistanceOpenedByClient({
        id: ticket!.id,
        number: ticket!.number,
        title: ticket!.title,
        organizationId: client.organizationId,
        clientId: req.portal!.clientId,
      });
      return ok(res, ticket, "Pedido de assistência enviado. A equipe vai te mandar as datas para a visita.");
    } catch (e) {
      await Promise.all(stored.map(({ key }) => storage.remove(key).catch(() => undefined)));
      throw e;
    }
  })
);

// GET /api/portal/assistances/options -> tipos de problema e limites do formulário
router.get(
  "/assistances/options",
  asyncHandler(async (_req, res) =>
    ok(res, {
      problemTypes: ASSISTANCE_PROBLEM_TYPES,
      minPhotos: MIN_ASSISTANCE_PHOTOS,
      maxPhotos: MAX_ASSISTANCE_PHOTOS_ON_OPEN,
      minDescription: MIN_ASSISTANCE_DESCRIPTION,
    })
  )
);

// ---------------- Agendamento da visita de assistência ----------------

// POST /api/portal/assistances/:id/choose  { optionId }
router.post(
  "/assistances/:id/choose",
  asyncHandler(async (req, res) => {
    const input = z.object({ optionId: z.string().min(1) }).parse(req.body);
    const t = await scheduleVisit({
      ticketId: req.params.id,
      scope: { clientId: req.portal!.clientId },
      optionId: input.optionId,
      actor: { kind: "CLIENT" },
    });
    return ok(res, serializeSchedule(t), "Data escolhida. Um dia antes enviamos um lembrete para confirmar.");
  })
);

async function ownTicket(id: string, clientId: string) {
  const t = await prisma.assistanceTicket.findFirst({ where: { id, clientId }, select: { id: true } });
  if (!t) throw new NotFoundError("Chamado não encontrado");
  return t;
}

// POST /api/portal/assistances/:id/confirm
router.post(
  "/assistances/:id/confirm",
  asyncHandler(async (req, res) => {
    const own = await ownTicket(req.params.id, req.portal!.clientId);
    return ok(res, serializeSchedule(await confirmVisit(own.id, "PORTAL")), "Visita confirmada");
  })
);

// POST /api/portal/assistances/:id/reschedule  { reason? }
router.post(
  "/assistances/:id/reschedule",
  asyncHandler(async (req, res) => {
    const own = await ownTicket(req.params.id, req.portal!.clientId);
    const input = z.object({ reason: z.string().trim().max(500).optional().nullable() }).parse(req.body ?? {});
    return ok(res, serializeSchedule(await requestReschedule(own.id, "PORTAL", input.reason ?? null)), "Pedido de nova data enviado à equipe");
  })
);

export default router;
