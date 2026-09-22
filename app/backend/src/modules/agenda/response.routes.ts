/**
 * Convites da agenda: /api/agenda/invitations e /api/agenda/:id/respond
 *
 * Montado antes do roteador principal da agenda, senão "invitations" seria
 * lido como o id de um compromisso.
 */
import { Router } from "express";
import { z } from "zod";
import { AgendaResponse } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { notifyUser } from "../../lib/notify";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { RESPONSE_LABEL, assertValidResponse } from "./response.service";

const router = Router();
router.use(authenticate);

// GET /api/agenda/invitations?pending=true -> compromissos para os quais fui convidado
router.get(
  "/invitations",
  requirePermission("agenda.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.agendaParticipant.findMany({
      where: {
        userId: req.user!.id,
        event: { organizationId: req.user!.organizationId, status: { notIn: ["CANCELLED", "COMPLETED"] }, endAt: { gte: new Date() } },
        ...(req.query.pending === "true" ? { response: AgendaResponse.PENDENTE } : {}),
      },
      include: {
        event: {
          select: {
            id: true, title: true, startAt: true, endAt: true, location: true, status: true,
            responsible: { select: { id: true, name: true } },
            client: { select: { id: true, name: true } },
            project: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: { event: { startAt: "asc" } },
      take: 100,
    });
    return ok(
      res,
      rows.map((r) => ({ ...r.event, response: r.response, responseLabel: RESPONSE_LABEL[r.response], respondedAt: r.respondedAt, proposedStart: r.proposedStart }))
    );
  })
);

// POST /api/agenda/:id/respond { response, note?, proposedStart? }
router.post(
  "/:id/respond",
  requirePermission("agenda.read"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        response: z.nativeEnum(AgendaResponse),
        note: z.string().trim().max(1000).optional().nullable(),
        proposedStart: z.coerce.date().optional().nullable(),
      })
      .parse(req.body);

    const event = await prisma.agendaEvent.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true, title: true, status: true, startAt: true, responsibleId: true, participants: { where: { userId: req.user!.id }, select: { userId: true } } },
    });
    if (!event) throw new NotFoundError("Compromisso não encontrado");
    assertValidResponse(event, input, req.user!.id, event.participants.length > 0);

    await prisma.$transaction([
      prisma.agendaParticipant.update({
        where: { eventId_userId: { eventId: event.id, userId: req.user!.id } },
        data: {
          response: input.response,
          respondedAt: new Date(),
          responseNote: input.note ?? null,
          proposedStart: input.response === AgendaResponse.REMARCAR ? input.proposedStart ?? null : null,
        },
      }),
      prisma.agendaEventHistory.create({
        data: {
          eventId: event.id,
          userId: req.user!.id,
          action: `RESPONSE_${input.response}`,
          toValue: { response: input.response, note: input.note ?? null, proposedStart: input.proposedStart?.toISOString() ?? null },
        },
      }),
    ]);

    // quem marcou fica sabendo, principalmente de recusa e pedido de remarcação
    const quando = input.proposedStart
      ? ` · sugere ${input.proposedStart.toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" })}`
      : "";
    await notifyUser(event.responsibleId, `${req.user!.name}: ${RESPONSE_LABEL[input.response].toLowerCase()}`, `${event.title}${quando}${input.note ? ` · ${input.note}` : ""}`);

    return ok(res, { eventId: event.id, response: input.response }, `Resposta enviada: ${RESPONSE_LABEL[input.response].toLowerCase()}`);
  })
);

export default router;
