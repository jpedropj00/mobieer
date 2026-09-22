/**
 * Rodadas da aprovação técnica.
 *
 * Antes desta fase, a aprovação era uma linha só por projeto: republicar
 * depois de um pedido de ajuste zerava o comentário do cliente, e com ele o
 * registro de qual versão foi rejeitada e por quê. Agora cada publicação abre
 * uma rodada, e a decisão do cliente fecha a rodada — que não muda mais.
 *
 * A aprovação em si continua protegida como já era: projeto aprovado não é
 * republicado nem reaberto.
 */
import { ApprovalRoundStatus, type Prisma } from "@prisma/client";

/**
 * Número da rodada que a publicação vai abrir. Se já existe uma rodada com o
 * número atual (o cliente já recebeu esta versão), a nova publicação é outra
 * rodada; senão é a primeira vez que este número vai ao cliente.
 */
export function nextRoundNumber(currentReviewRound: number, currentRoundExists: boolean): number {
  return currentRoundExists ? currentReviewRound + 1 : currentReviewRound;
}

/** Rodada ainda sem resposta que é substituída por uma republicação. */
export const isOpenRound = (status: ApprovalRoundStatus) => status === ApprovalRoundStatus.PUBLICADA;

/** Decisão do cliente → status final da rodada. */
export function roundStatusFor(decision: "APPROVED" | "CHANGES_REQUESTED"): ApprovalRoundStatus {
  return decision === "APPROVED" ? ApprovalRoundStatus.APROVADA : ApprovalRoundStatus.MUDANCAS_SOLICITADAS;
}

/**
 * Abre a rodada da publicação. Devolve o número a gravar em `reviewRound`.
 * A rodada em aberto (cliente ainda não respondeu) vira SUBSTITUIDA — fica no
 * histórico, não some.
 */
export async function openRound(
  tx: Prisma.TransactionClient,
  approval: { id: string; reviewRound: number; documentId: string | null },
  publishedById: string
): Promise<number> {
  const current = await tx.techApprovalRound.findUnique({
    where: { approvalId_round: { approvalId: approval.id, round: approval.reviewRound } },
    select: { id: true, status: true },
  });
  if (current && isOpenRound(current.status)) {
    await tx.techApprovalRound.update({ where: { id: current.id }, data: { status: ApprovalRoundStatus.SUBSTITUIDA } });
  }
  const round = nextRoundNumber(approval.reviewRound, Boolean(current));

  const doc = approval.documentId
    ? await tx.projectDocument.findUnique({ where: { id: approval.documentId }, select: { checksum: true } })
    : null;

  await tx.techApprovalRound.create({
    data: {
      approvalId: approval.id,
      round,
      documentId: approval.documentId,
      status: ApprovalRoundStatus.PUBLICADA,
      publishedById,
      documentChecksum: doc?.checksum ?? null,
    },
  });
  return round;
}

/** Fecha a rodada atual com a decisão do cliente. */
export async function closeRound(
  tx: Prisma.TransactionClient,
  approvalId: string,
  round: number,
  decision: "APPROVED" | "CHANGES_REQUESTED",
  info: { decidedByName?: string | null; comment?: string | null }
) {
  // aprovação publicada antes desta fase pode não ter a linha da rodada
  await tx.techApprovalRound.upsert({
    where: { approvalId_round: { approvalId, round } },
    create: {
      approvalId,
      round,
      status: roundStatusFor(decision),
      decidedAt: new Date(),
      decidedByName: info.decidedByName ?? null,
      clientComment: info.comment ?? null,
    },
    update: {
      status: roundStatusFor(decision),
      decidedAt: new Date(),
      decidedByName: info.decidedByName ?? null,
      clientComment: info.comment ?? null,
    },
  });
}
