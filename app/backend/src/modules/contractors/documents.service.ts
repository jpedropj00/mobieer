/**
 * Entrega e assinatura dos documentos do montador (§7).
 *
 * O documento sai da empresa, chega ao montador, é lido e — quando for o caso —
 * assinado ou recusado. Os seis status da especificação são exatamente esses
 * passos, e quem manda neles é esta máquina de estados: as rotas só perguntam
 * se a transição vale.
 *
 *   AGUARDANDO_ENVIO ──enviar──▶ ENVIADO ──visualizar──▶ VISUALIZADO
 *                                                             │
 *                                          (exige assinatura) │
 *                                                             ▼
 *                                                   AGUARDANDO_ASSINATURA
 *                                                        │        │
 *                                                 assinar│        │recusar
 *                                                        ▼        ▼
 *                                                   ASSINADO   RECUSADO
 *                                                                 │
 *                                                        reenviar │
 *                                                                 ▼
 *                                                             ENVIADO
 *
 * Documento sem assinatura termina em VISUALIZADO: já cumpriu o papel de ter
 * sido entregue e lido. ASSINADO é final — reenviar exigiria uma versão nova,
 * porque sobrescrever apagaria a prova de quem assinou o quê.
 */
import { ContractorDocumentStatus } from "@prisma/client";

export type DeliveryEvent = "ENVIAR" | "VISUALIZAR" | "ASSINAR" | "RECUSAR" | "REENVIAR";

export type TransitionResult =
  | { ok: true; status: ContractorDocumentStatus }
  | { ok: false; motivo: string };

const S = ContractorDocumentStatus;

/** Status em que o montador já consegue abrir o documento. */
export const VISIVEL_PARA_O_MONTADOR: ContractorDocumentStatus[] = [
  S.ENVIADO,
  S.VISUALIZADO,
  S.AGUARDANDO_ASSINATURA,
  S.ASSINADO,
  S.RECUSADO,
];

/** Já saiu da empresa? Antes disso é rascunho e ninguém de fora vê. */
export const foiEnviado = (status: ContractorDocumentStatus) => VISIVEL_PARA_O_MONTADOR.includes(status);

/** Acabou? ASSINADO encerra; VISUALIZADO encerra quando não pede assinatura. */
export const estaConcluido = (status: ContractorDocumentStatus, requiresSignature: boolean) =>
  status === S.ASSINADO || (!requiresSignature && status === S.VISUALIZADO);

/**
 * A transição vale? Devolve o status novo ou o motivo da recusa — a mensagem
 * vai direto para a tela, então explica o que aconteceu, não o nome do estado.
 */
export function nextStatus(
  atual: ContractorDocumentStatus,
  evento: DeliveryEvent,
  requiresSignature: boolean
): TransitionResult {
  switch (evento) {
    case "ENVIAR":
      if (atual === S.ASSINADO) return { ok: false, motivo: "Este documento já está assinado." };
      if (atual !== S.AGUARDANDO_ENVIO) return { ok: false, motivo: "Este documento já foi enviado ao montador." };
      return { ok: true, status: S.ENVIADO };

    case "REENVIAR":
      // Só faz sentido depois de uma recusa: a empresa corrige e manda de novo.
      if (atual !== S.RECUSADO) return { ok: false, motivo: "Só dá para reenviar um documento que foi recusado." };
      return { ok: true, status: S.ENVIADO };

    case "VISUALIZAR":
      if (!foiEnviado(atual)) return { ok: false, motivo: "O documento ainda não foi enviado ao montador." };
      // Abrir de novo não volta o status: assinado continua assinado.
      if (atual !== S.ENVIADO) return { ok: true, status: atual };
      return { ok: true, status: requiresSignature ? S.AGUARDANDO_ASSINATURA : S.VISUALIZADO };

    case "ASSINAR":
      if (!requiresSignature) return { ok: false, motivo: "Este documento não pede assinatura." };
      if (!foiEnviado(atual)) return { ok: false, motivo: "O documento ainda não foi enviado ao montador." };
      if (atual === S.ASSINADO) return { ok: false, motivo: "Este documento já está assinado." };
      return { ok: true, status: S.ASSINADO };

    case "RECUSAR":
      if (!requiresSignature) return { ok: false, motivo: "Este documento não pede assinatura, então não há o que recusar." };
      if (!foiEnviado(atual)) return { ok: false, motivo: "O documento ainda não foi enviado ao montador." };
      if (atual === S.ASSINADO) return { ok: false, motivo: "Este documento já está assinado e não pode ser recusado." };
      return { ok: true, status: S.RECUSADO };
  }
}

/** Rótulos da tela, no mesmo vocabulário da especificação. */
export const STATUS_LABEL: Record<ContractorDocumentStatus, string> = {
  AGUARDANDO_ENVIO: "Aguardando envio",
  ENVIADO: "Enviado",
  VISUALIZADO: "Visualizado",
  AGUARDANDO_ASSINATURA: "Aguardando assinatura",
  ASSINADO: "Assinado",
  RECUSADO: "Recusado",
};

/**
 * Assinatura desenhada: PNG em data URL, como o SignaturePad do frontend
 * produz. Recusa qualquer outra coisa para não gravar HTML ou SVG (que
 * executaria script) num campo que a tela renderiza como imagem.
 */
export function isAssinaturaValida(dataUrl: string | null | undefined): boolean {
  if (!dataUrl) return false;
  if (!/^data:image\/png;base64,/.test(dataUrl)) return false;
  const base64 = dataUrl.slice("data:image/png;base64,".length);
  // um PNG de verdade não cabe em poucos bytes; e o conteúdo tem que ser base64
  return base64.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
}

/** Limite do PNG da assinatura, para um desenho não virar upload disfarçado. */
export const ASSINATURA_MAX_BYTES = 512 * 1024;

export function assinaturaCabe(dataUrl: string, max = ASSINATURA_MAX_BYTES): boolean {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  // cada 4 caracteres de base64 viram 3 bytes
  return Math.ceil((base64.length * 3) / 4) <= max;
}
