import { prisma } from "../prisma";
import { sendWhatsAppText } from "./whatsapp";

/**
 * Avisa o cliente por WhatsApp (quando há telefone e a integração está ativa).
 * Fire-and-forget: nunca lança — falha de canal não pode quebrar o fluxo.
 * Sem WHATSAPP_* configurado, a mensagem só vai para o log.
 */
export async function notifyClientWhatsApp(clientId: string | null | undefined, text: string): Promise<void> {
  if (!clientId) return;
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { phone: true } });
    if (!client?.phone) return;
    await sendWhatsAppText(client.phone, text);
  } catch (e) {
    console.error("[client-comms] falha ao avisar o cliente:", e instanceof Error ? e.message : e);
  }
}
