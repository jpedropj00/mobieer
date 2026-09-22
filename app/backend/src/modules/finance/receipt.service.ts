/**
 * Recibo de pagamento (§3.4, §9).
 *
 * Só nasce depois que o financeiro registra o pagamento — o comprovante
 * enviado pelo cliente é prova, não confirmação. O recibo fica visível no
 * portal e o cliente é avisado.
 *
 * Emitir de novo gera outra versão do mesmo recibo (mesmo número), nunca um
 * segundo recibo para o mesmo pagamento.
 */
import { sendAutomation } from "../../lib/automations";
import { prisma } from "../../prisma";
import { NotFoundError, ValidationError } from "../../utils/ApiError";
import { buildReceipt, receiptNumber, storeGeneratedPdf } from "../docgen/docgen.service";
import { brl } from "../templates/contract.service";

export async function issueReceipt(paymentId: string, organizationId: string, userId: string | null) {
  const pay = await prisma.financePayment.findFirst({
    where: { id: paymentId, transaction: { organizationId } },
    include: {
      transaction: {
        select: {
          id: true, type: true, category: true, description: true, docNumber: true,
          installmentNumber: true, installmentTotal: true,
          client: { select: { id: true, name: true, document: true } },
          project: { select: { id: true, code: true, name: true } },
          organization: { select: { name: true, enterprise: { select: { tradeName: true, legalName: true, document: true } } } },
        },
      },
    },
  });
  if (!pay) throw new NotFoundError("Pagamento não encontrado");
  const t = pay.transaction;
  if (t.type !== "RECEITA") throw new ValidationError("Recibo é emitido para recebimentos de cliente, não para despesas");
  if (!t.client) throw new ValidationError("Este recebimento não está ligado a um cliente");

  const reference = [
    t.installmentNumber && t.installmentTotal ? `parcela ${t.installmentNumber}/${t.installmentTotal}` : null,
    t.description || t.category,
    t.project ? `do projeto ${t.project.code}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const number = receiptNumber(pay.id);
  const built = buildReceipt({
    number,
    company: {
      name: t.organization.enterprise.tradeName || t.organization.enterprise.legalName || t.organization.name,
      document: t.organization.enterprise.document ?? null,
    },
    payer: { name: t.client.name, document: t.client.document },
    amount: Number(pay.amount),
    paidAt: pay.paidAt,
    method: pay.method,
    reference,
    projectCode: t.project?.code ?? null,
    issuedAt: new Date(),
  });

  const doc = await storeGeneratedPdf({
    organizationId,
    clientId: t.client.id,
    projectId: t.project?.id ?? null,
    type: "RECIBO",
    generatedFrom: "RECIBO",
    title: `Recibo ${number}`,
    fileName: `recibo-${number}.pdf`,
    built,
    visibleToClient: true,
    uploadedById: userId,
    replacesId: pay.receiptDocumentId,
  });

  await prisma.financePayment.update({ where: { id: pay.id }, data: { receiptDocumentId: doc.id } });
  await prisma.auditLog.create({
    data: { userId, action: "RECEIPT_ISSUED", entity: "FinancePayment", entityId: pay.id, details: { number, documentId: doc.id, version: doc.version } },
  });

  // só avisa o cliente na primeira emissão; reemissão é correção interna
  if (!pay.receiptDocumentId) {
    void sendAutomation("RECEIPT_AVAILABLE", {
      organizationId,
      clientId: t.client.id,
      vars: { "recibo.numero": number, "recibo.valor": brl(Number(pay.amount)) },
      dedupeKey: `receipt:${pay.id}`,
    });
  }
  return { documentId: doc.id, number, version: doc.version };
}
