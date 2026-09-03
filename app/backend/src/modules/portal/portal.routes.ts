import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { authenticateClient, signPortalToken } from "../../middlewares/portalAuth";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { sendMail, renderResetEmail } from "../../lib/mailer";
import { storage } from "../../lib/storage";
import { recomputeSignatureStatus } from "../documents/documents.routes";

const router = Router();

const passwordSchema = z.string().min(8, "A senha deve ter ao menos 8 caracteres").max(100);

async function companyNameForClient(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { organization: { select: { name: true, enterprise: { select: { tradeName: true, legalName: true } } } } },
  });
  return (
    client?.organization.enterprise.tradeName ||
    client?.organization.enterprise.legalName ||
    client?.organization.name ||
    "MOBIEER"
  );
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
    if (account.client.status !== "ACTIVE") throw new UnauthorizedError("Cadastro do cliente inativo");

    const valid = await bcrypt.compare(password, account.passwordHash);
    if (!valid) throw new UnauthorizedError("Credenciais inválidas");

    await prisma.clientAccount.update({ where: { id: account.id }, data: { lastLogin: new Date() } });

    return ok(res, {
      token: signPortalToken(account.id, account.clientId),
      account: { id: account.id, name: account.name, email: account.email },
      client: { id: account.client.id, name: account.client.name },
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
      token: signPortalToken(updated.id, updated.clientId),
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
      const companyName = await companyNameForClient(account.clientId);
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

// ============================================================
// DADOS DO CLIENTE (token do portal)
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
        assistances: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            priority: true,
            createdAt: true,
            resolvedAt: true,
            origin: true,
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

    return ok(res, {
      ...project,
      feedbackFormUrl: project.feedbackFormUrl || env.clientFeedbackFormUrl || null,
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
    stream.pipe(res);
  })
);

router.get(
  "/assistances",
  asyncHandler(async (req, res) => {
    const items = await prisma.assistanceTicket.findMany({
      where: { clientId: req.portal!.clientId },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        origin: true,
        createdAt: true,
        resolvedAt: true,
        project: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, items);
  })
);

router.post(
  "/assistances",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(3).max(255),
        description: z.string().trim().min(5).max(10000),
        projectId: z.string().min(1).optional().nullable(),
      })
      .parse(req.body);

    const client = await prisma.client.findUnique({
      where: { id: req.portal!.clientId },
      select: { organizationId: true },
    });
    if (!client) throw new BadRequestError("Cliente inválido");

    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, clientId: req.portal!.clientId },
        select: { id: true },
      });
      if (!project) throw new BadRequestError("Projeto inválido");
    }

    const count = await prisma.assistanceTicket.count({ where: { organizationId: client.organizationId } });
    const number = `AST-${String(count + 1).padStart(5, "0")}`;

    const ticket = await prisma.assistanceTicket.create({
      data: {
        number,
        organizationId: client.organizationId,
        clientId: req.portal!.clientId,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description,
        status: "OPEN",
        origin: "CLIENT_PORTAL",
        openedByClientAccountId: req.portal!.accountId,
      },
      select: { id: true, number: true, title: true, status: true, createdAt: true },
    });

    return ok(res, ticket, "Chamado aberto");
  })
);

export default router;
