/**
 * Confirmação da medição pelo cliente. A equipe marca dia e hora; o cliente
 * confirma no portal ou diz que não pode e sugere outras datas — aí a visita
 * volta para a equipe remarcar. Regras puras.
 */

export type ConfirmationState =
  | "AWAITING" // equipe marcou, cliente ainda não respondeu
  | "CONFIRMED" // cliente confirmou o dia e a hora
  | "RESCHEDULE_REQUESTED"; // cliente não pode e sugeriu outras datas

export const CONFIRMATION_LABEL: Record<ConfirmationState, string> = {
  AWAITING: "Aguardando o cliente confirmar",
  CONFIRMED: "Cliente confirmou",
  RESCHEDULE_REQUESTED: "Cliente pediu outra data",
};

export function confirmationState(v: { status: string; scheduledAt: Date | null; clientConfirmedAt?: Date | null; rescheduleRequestedAt?: Date | null }): ConfirmationState | null {
  if (v.status === "SCHEDULED" && v.scheduledAt) return v.clientConfirmedAt ? "CONFIRMED" : "AWAITING";
  if (v.status === "REQUESTED" && v.rescheduleRequestedAt) return "RESCHEDULE_REQUESTED";
  return null;
}

/** Mudou o dia/hora marcado? Então a confirmação anterior do cliente não vale mais. */
export function scheduleChanged(before: Date | null, after: Date | null | undefined) {
  if (after === undefined) return false;
  return (before?.getTime() ?? null) !== (after?.getTime() ?? null);
}

/** Datas sugeridas pelo cliente: aaaa-mm-dd, de hoje em diante, sem repetir, até 3. */
export function cleanPreferredDates(dates: string[], today: string): string[] {
  return [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today))].sort().slice(0, 3);
}
