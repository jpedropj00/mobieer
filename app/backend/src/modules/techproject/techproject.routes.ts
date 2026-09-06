import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { approvalInclude, getOrCreateApproval, serializeApproval } from "./techproject.service";
import { notifyClientWhatsApp } from "../../lib/client-comms";

const router = Router();
router.use(authenticate);

const nn = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

async function ensureProject(id: string, organizationId: string) {
  const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, code: true, name: true, managerId: true, clientId: true } });
  if (!p) throw new NotFoundError("Projeto não encontrado");
  return p;
}
async function notify(userId: string | null | undefined, title: string, message: string) {
  if (!userId) return;
  await prisma.notification.create({ data: { type: "INFO", title, message, userId } });
}

// GET /api/tech-approval  -> painel geral (aguardando cliente / mudanças pedidas)
router.get(
  "/",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.technicalProjectApproval.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.status ? { status: req.query.status as never } : { status: { not: "DRAFT" } }),
      },
      include: approvalInclude,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return ok(res, rows.map((r) => serializeApproval(r)));
  })
);

// GET /api/tech-approval/projects/:projectId  -> ficha + documentos candidatos
router.get(
  "/projects/:projectId",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    await ensureProject(req.params.projectId, req.user!.organizationId);
    const approval = await getOrCreateApproval(req.params.projectId, req.user!.organizationId);
    const documents = await prisma.projectDocument.findMany({
      where: { organizationId: req.user!.organizationId, projectId: req.params.projectId },
      select: { id: true, title: true, type: true, fileName: true, visibleToClient: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, { approval: serializeApproval(approval, { includeSignature: true }), documents });
  })
);

// PATCH /api/tech-approval/projects/:projectId  -> termo, documento, publicar/reabrir
router.patch(
  "/projects/:projectId",
  requirePermission("organization.manage"),
  asyncHandler(async (req, res) => {
    const project = await ensureProject(req.params.projectId, req.user!.organizationId);
    const cur = await getOrCreateApproval(project.id, req.user!.organizationId);
    const input = z
      .object({
        termText: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
        documentId: z.string().min(1).optional().nullable(),
        action: z.enum(["publish", "reopen"]).optional(),
      })
      .parse(req.body);

    if (input.documentId) {
      const doc = await prisma.projectDocument.findFirst({
        where: { id: input.documentId, organizationId: req.user!.organizationId, projectId: project.id },
        select: { id: true },
      });
      if (!doc) throw new BadRequestError("Documento inválido para este projeto");
    }

    const data: Prisma.TechnicalProjectApprovalUpdateInput = {
      termText: input.termText === undefined ? undefined : nn(input.termText),
      document:
        input.documentId === undefined
          ? undefined
          : input.documentId
            ? { connect: { id: input.documentId } }
            : { disconnect: true },
    };

    if (input.action === "publish") {
      if (cur.status === "APPROVED") throw new BadRequestError("Este projeto técnico já foi aprovado pelo cliente");
      data.status = "IN_REVIEW";
      data.publishedAt = new Date();
      data.publishedBy = { connect: { id: req.user!.id } };
      if (cur.status === "CHANGES_REQUESTED") {
        data.reviewRound = { increment: 1 };
        data.clientComment = null;
      }
    }
    if (input.action === "reopen") {
      if (cur.status === "APPROVED") throw new BadRequestError("Não é possível reabrir um projeto já aprovado");
      data.status = "DRAFT";
    }

    const approval = await prisma.technicalProjectApproval.update({
      where: { id: cur.id },
      data,
      include: approvalInclude,
    });
    if (input.action === "publish") {
      void notifyClientWhatsApp(
        project.clientId,
        `O projeto técnico do contrato ${project.code} está disponível no portal para sua revisão e aprovação. — MOBIEER`
      );
    }
    return ok(res, serializeApproval(approval, { includeSignature: true }), input.action === "publish" ? "Projeto técnico enviado ao cliente" : "Atualizado");
  })
);

export default router;
