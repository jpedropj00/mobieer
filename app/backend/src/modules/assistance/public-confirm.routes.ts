/**
 * Confirmação da visita de assistência SEM login — é o link que vai no lembrete
 * de véspera do WhatsApp. O token é aleatório (24 bytes), troca a cada
 * reagendamento e só vale enquanto a visita estiver marcada.
 *
 * Mostra o mínimo: número do chamado, primeiro nome e data. Nada de endereço,
 * telefone ou descrição.
 */
import { Router } from "express";
import { z } from "zod";
import { fmtVisit } from "../../lib/automations";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { InvalidStateError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { firstName } from "../../utils/template";
import { confirmVisit, requestReschedule } from "./assistance.service";

const router = Router();
const DAY_MS = 86400000;

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new NotFoundError("Link inválido ou expirado");
  const t = await prisma.assistanceTicket.findUnique({
    where: { confirmToken: token },
    select: {
      id: true,
      number: true,
      status: true,
      scheduledAt: true,
      schedulePeriod: true,
      clientConfirmedAt: true,
      client: { select: { name: true } },
      organization: { select: { name: true, enterprise: { select: { tradeName: true, legalName: true } } } },
    },
  });
  // Visita passada há mais de 1 dia também invalida o link.
  if (!t || t.status !== "SCHEDULED" || !t.scheduledAt || t.scheduledAt.getTime() < Date.now() - DAY_MS) {
    throw new NotFoundError("Link inválido ou expirado");
  }
  return t;
}

const view = (t: Awaited<ReturnType<typeof byToken>>) => ({
  number: t.number,
  clientFirstName: firstName(t.client.name),
  companyName: t.organization.enterprise.tradeName || t.organization.enterprise.legalName || t.organization.name,
  scheduledAt: t.scheduledAt,
  scheduledLabel: t.scheduledAt ? fmtVisit(t.scheduledAt, t.schedulePeriod) : null,
  confirmed: Boolean(t.clientConfirmedAt),
});

// GET /api/public/assistance/confirm/:token
router.get(
  "/assistance/confirm/:token",
  asyncHandler(async (req, res) => ok(res, view(await byToken(req.params.token))))
);

// POST /api/public/assistance/confirm/:token  { action: "confirm" | "reschedule", reason? }
router.post(
  "/assistance/confirm/:token",
  asyncHandler(async (req, res) => {
    const t = await byToken(req.params.token);
    const input = z
      .object({ action: z.enum(["confirm", "reschedule"]), reason: z.string().trim().max(500).optional().nullable() })
      .parse(req.body);

    if (input.action === "confirm") {
      if (t.clientConfirmedAt) return ok(res, view(t), "Visita já estava confirmada");
      await confirmVisit(t.id, "LINK");
      return ok(res, { ...view(t), confirmed: true }, "Visita confirmada. Obrigado!");
    }
    if (!t.scheduledAt) throw new InvalidStateError("Esta visita não tem data marcada");
    await requestReschedule(t.id, "LINK", input.reason ?? null);
    return ok(res, { ...view(t), confirmed: false, rescheduleRequested: true }, "Pedido de nova data enviado. A equipe vai te mandar outras opções.");
  })
);

export default router;
