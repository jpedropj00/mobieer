/**
 * Pagamentos no portal do cliente: /api/portal/finance
 *
 * O cliente vê só as próprias parcelas (filtro por req.portal.clientId em
 * todas as consultas) e pode enviar o comprovante. Enviar comprovante NÃO dá
 * baixa: o financeiro confere e registra o pagamento, e só então o recibo é
 * emitido e aparece aqui.
 */
import { Router } from "express";
import { FinanceStatus } from "@prisma/client";
import { authenticateClient } from "../../middlewares/portalAuth";
import { uploadDocument } from "../../middlewares/upload";
import { buildStorageKey, storage } from "../../lib/storage";
import { notifyUsersWithPermission } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError, ValidationError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { rateLimit } from "../../utils/rate-limit";
import { DEFAULT_ALERT_DAYS, financeSituation, remainingBalance } from "../finance/documents.service";

const router = Router();
router.use(authenticateClient);

const money = (v: unknown) => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

// Comprovante é imagem ou PDF; o resto não serve de comprovante.
const PROOF_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

// GET /api/portal/finance
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const clientId = req.portal!.clientId;
    const rows = await prisma.financeTransaction.findMany({
      where: { clientId, type: "RECEITA", status: { not: FinanceStatus.CANCELADO } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: {
        id: true, category: true, description: true, amount: true, paidAmount: true, status: true,
        dueDate: true, alertDays: true, installmentNumber: true, installmentTotal: true,
        project: { select: { id: true, code: true, name: true } },
        payments: {
          orderBy: { paidAt: "asc" },
          select: { id: true, amount: true, paidAt: true, method: true, receiptDocumentId: true, receiptDocument: { select: { title: true } } },
        },
        attachments: {
          where: { uploadedByClientAccountId: { not: null } },
          orderBy: { createdAt: "desc" },
          select: { id: true, fileName: true, createdAt: true, reviewedAt: true },
        },
      },
    });

    const items = rows.map((r) => {
      const amount = money(r.amount);
      const paid = money(r.paidAmount);
      const situation = financeSituation(r, DEFAULT_ALERT_DAYS);
      return {
        id: r.id,
        label: [r.installmentNumber && r.installmentTotal ? `Parcela ${r.installmentNumber}/${r.installmentTotal}` : null, r.description || r.category]
          .filter(Boolean)
          .join(" · "),
        project: r.project,
        amount,
        paidAmount: paid,
        remaining: remainingBalance(amount, paid),
        dueDate: r.dueDate,
        // para o cliente, "próximo do vencimento" não é um alarme: fica como pendente
        situation: situation === "A_VENCER" ? "PENDENTE" : situation,
        payments: r.payments.map((p) => ({
          id: p.id,
          amount: money(p.amount),
          paidAt: p.paidAt,
          method: p.method,
          receipt: p.receiptDocumentId ? { documentId: p.receiptDocumentId, title: p.receiptDocument?.title ?? "Recibo" } : null,
        })),
        proofs: r.attachments.map((a) => ({ id: a.id, fileName: a.fileName, sentAt: a.createdAt, checked: Boolean(a.reviewedAt) })),
      };
    });

    const total = round2(items.reduce((s, i) => s + i.amount, 0));
    const pago = round2(items.reduce((s, i) => s + i.paidAmount, 0));
    const next = items.find((i) => i.remaining > 0 && i.dueDate);
    return ok(res, {
      totals: { total, pago, pendente: round2(total - pago), parcelas: items.length, pagas: items.filter((i) => i.situation === "PAGO").length },
      nextDue: next ? { id: next.id, label: next.label, remaining: next.remaining, dueDate: next.dueDate } : null,
      items,
    });
  })
);

// POST /api/portal/finance/:id/proof (multipart "file")
router.post(
  "/:id/proof",
  rateLimit({ name: "portal-proof", windowMs: 60 * 60 * 1000, max: 20 }),
  uploadDocument.single("file"),
  asyncHandler(async (req, res) => {
    const clientId = req.portal!.clientId;
    // a parcela precisa ser do próprio cliente — nunca por id solto
    const doc = await prisma.financeTransaction.findFirst({
      where: { id: req.params.id, clientId, type: "RECEITA" },
      select: { id: true, organizationId: true, status: true, category: true, amount: true, paidAmount: true, client: { select: { name: true } } },
    });
    if (!doc) throw new NotFoundError("Parcela não encontrada");
    if (doc.status === FinanceStatus.CANCELADO) throw new ValidationError("Esta parcela foi cancelada");
    if (doc.status === FinanceStatus.PAGO) throw new ValidationError("Esta parcela já está quitada");
    if (!req.file) throw new ValidationError("Envie o comprovante (foto ou PDF)");
    if (!PROOF_MIME.test(req.file.mimetype)) throw new ValidationError("O comprovante precisa ser uma foto ou um PDF");

    const pendentes = await prisma.financeAttachment.count({
      where: { transactionId: doc.id, uploadedByClientAccountId: { not: null }, reviewedAt: null },
    });
    if (pendentes >= 3) throw new ValidationError("Já há comprovantes aguardando conferência para esta parcela");

    const key = buildStorageKey(`finance/${doc.id}/proofs`, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    try {
      const a = await prisma.financeAttachment.create({
        data: {
          transactionId: doc.id,
          kind: "COMPROVANTE",
          storageKey: key,
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedByClientAccountId: req.portal!.accountId,
        },
        select: { id: true, fileName: true, createdAt: true },
      });
      await prisma.auditLog.create({
        data: { userId: null, action: "CLIENT_PROOF_UPLOADED", entity: "FinanceTransaction", entityId: doc.id, details: { attachmentId: a.id, clientAccountId: req.portal!.accountId } },
      });
      await notifyUsersWithPermission({
        organizationId: doc.organizationId,
        permission: "finance.documents.pay",
        title: "Comprovante enviado pelo cliente",
        message: `${doc.client?.name ?? "Cliente"} · ${doc.category} — conferir e registrar o pagamento`,
      });
      return ok(res, a, "Comprovante enviado. O financeiro vai conferir e liberar o recibo.");
    } catch (e) {
      await storage.remove(key).catch(() => undefined);
      throw e;
    }
  })
);

export default router;
