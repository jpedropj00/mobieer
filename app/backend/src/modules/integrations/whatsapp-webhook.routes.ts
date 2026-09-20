/**
 * Webhook do WhatsApp (Meta Cloud API): recebe as respostas dos clientes.
 *
 * Uso atual: responder CONFIRMAR ou REMARCAR ao lembrete de véspera da
 * assistência. A mensagem é ligada ao chamado pelo telefone do cliente.
 *
 * Configuração na Meta: URL `https://<api>/api/integrations/whatsapp/webhook`,
 * token de verificação = WHATSAPP_VERIFY_TOKEN, campo "messages". Com
 * WHATSAPP_APP_SECRET definido, a assinatura X-Hub-Signature-256 é validada.
 */
import crypto from "crypto";
import { Router, type Request } from "express";
import { env } from "../../config/env";
import { toWhatsAppNumber } from "../../lib/whatsapp";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ForbiddenError, UnauthorizedError } from "../../utils/ApiError";
import { confirmVisit, parseClientReply, requestReschedule } from "../assistance/assistance.service";

const router = Router();

/** Assinatura HMAC-SHA256 do corpo cru com o App Secret. */
export function validMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string) {
  if (!appSecret) return true; // sem segredo configurado não há o que validar
  if (!rawBody || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

type InboundMessage = { from: string; text: string };

/** Extrai as mensagens de texto/botão do payload da Meta. */
export function extractInboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: { messages?: unknown[] } }[] }[]) {
    for (const change of entry.changes ?? []) {
      for (const m of (change.value?.messages ?? []) as {
        from?: string;
        type?: string;
        text?: { body?: string };
        button?: { text?: string; payload?: string };
        interactive?: { button_reply?: { title?: string; id?: string } };
      }[]) {
        const text = m.text?.body ?? m.button?.payload ?? m.button?.text ?? m.interactive?.button_reply?.id ?? m.interactive?.button_reply?.title;
        if (m.from && text) out.push({ from: m.from, text });
      }
    }
  }
  return out;
}

/** Variações do número (com e sem o 9º dígito) para achar o cliente cadastrado. */
function phoneVariants(num: string) {
  const d = num.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d; // DDD + número
  const variants = new Set([local]);
  if (local.length === 11) variants.add(local.slice(0, 2) + local.slice(3)); // sem o 9
  if (local.length === 10) variants.add(`${local.slice(0, 2)}9${local.slice(2)}`); // com o 9
  return [...variants];
}

// GET: verificação do webhook pela Meta
router.get("/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && env.whatsapp.webhookVerifyToken && token === env.whatsapp.webhookVerifyToken) {
    return res.status(200).send(String(challenge ?? ""));
  }
  throw new ForbiddenError("Token de verificação inválido");
});

// POST: mensagens recebidas
router.post(
  "/whatsapp/webhook",
  asyncHandler(async (req: Request & { rawBody?: Buffer }, res) => {
    if (!validMetaSignature(req.rawBody, req.header("x-hub-signature-256"), env.whatsapp.appSecret)) {
      throw new UnauthorizedError("Assinatura do webhook inválida");
    }

    const handled: { from: string; action: string; ticket?: string }[] = [];
    for (const msg of extractInboundMessages(req.body)) {
      const reply = parseClientReply(msg.text);
      if (!reply || !toWhatsAppNumber(msg.from)) continue;

      // Chamado com lembrete enviado, ainda sem confirmação, de um cliente com esse telefone.
      const candidates = await prisma.assistanceTicket.findMany({
        where: {
          status: "SCHEDULED",
          reminderSentAt: { not: null },
          clientConfirmedAt: null,
          scheduledAt: { gte: new Date(Date.now() - 12 * 3600 * 1000) },
          client: { OR: phoneVariants(msg.from).map((v) => ({ phone: { contains: v.slice(-8) } })) },
        },
        select: { id: true, number: true, client: { select: { phone: true } } },
        orderBy: { scheduledAt: "asc" },
      });
      // Confere o número inteiro (o filtro acima usa só os 8 últimos dígitos).
      const ticket = candidates.find((c) => {
        const n = toWhatsAppNumber(c.client.phone);
        return n !== null && phoneVariants(n).some((v) => phoneVariants(msg.from).includes(v));
      });
      if (!ticket) continue;

      if (reply === "CONFIRM") await confirmVisit(ticket.id, "WHATSAPP");
      else await requestReschedule(ticket.id, "WHATSAPP", msg.text.slice(0, 300));
      handled.push({ from: msg.from.slice(-4), action: reply, ticket: ticket.number });
    }

    // A Meta só precisa de 200; o corpo é para diagnóstico.
    return res.status(200).json({ success: true, handled });
  })
);

export default router;
