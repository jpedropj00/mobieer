/**
 * Resposta do convidado a um compromisso (§12: receber, aceitar, remarcar).
 * Regras puras.
 */
import { AgendaResponse } from "@prisma/client";
import { ForbiddenError, ValidationError } from "../../utils/ApiError";

const CLOSED = ["CANCELLED", "COMPLETED"];

export type ResponseInput = { response: AgendaResponse; note?: string | null; proposedStart?: Date | null };

/**
 * Valida a resposta. Só quem foi convidado responde; compromisso encerrado não
 * recebe resposta; pedir para remarcar exige sugerir um horário futuro, e
 * recusar pede o motivo (quem marcou precisa saber o que fazer).
 */
export function assertValidResponse(
  event: { status: string; startAt: Date; responsibleId: string },
  input: ResponseInput,
  userId: string,
  isParticipant: boolean,
  now = new Date()
) {
  if (event.responsibleId === userId) throw new ValidationError("Você é o responsável por este compromisso — ele já é seu");
  if (!isParticipant) throw new ForbiddenError("Você não foi convidado para este compromisso");
  if (CLOSED.includes(event.status)) throw new ValidationError("Este compromisso já foi encerrado");
  if (input.response === AgendaResponse.PENDENTE) throw new ValidationError("Escolha aceitar, recusar ou pedir outro horário");

  if (input.response === AgendaResponse.REMARCAR) {
    if (!input.proposedStart) throw new ValidationError("Sugira o novo horário para remarcar");
    if (input.proposedStart.getTime() <= now.getTime()) throw new ValidationError("O novo horário precisa estar no futuro");
  }
  if (input.response === AgendaResponse.RECUSADO && !input.note?.trim()) {
    throw new ValidationError("Diga o motivo da recusa para quem marcou o compromisso");
  }
}

export const RESPONSE_LABEL: Record<AgendaResponse, string> = {
  PENDENTE: "Aguardando resposta",
  ACEITO: "Aceitou",
  RECUSADO: "Recusou",
  REMARCAR: "Pediu outro horário",
};
