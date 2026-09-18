import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import {
  VISIT_PERIODS,
  confirmVisit,
  proposeVisitOptions,
  scheduleSelect,
  scheduleVisit,
  serializeSchedule,
} from "./assistance.service";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";

/** Rotas da equipe: /api/assistance */
const router = Router();
router.use(authenticate);

const optionSchema = z.object({
  startsAt: z.coerce.date(),
  period: z.enum(VISIT_PERIODS).optional().nullable(),
});

// GET /api/assistance/:id/schedule
router.get(
  "/:id/schedule",
  requirePermission("organization.read"),
  asyncHandler(async (req, res) => {
    const t = await prisma.assistanceTicket.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: scheduleSelect,
    });
    if (!t) throw new NotFoundError("Chamado de assistência não encontrado");
    return ok(res, serializeSchedule(t));
  })
);

// POST /api/assistance/:id/options  { options: [{ startsAt, period }] }
router.post(
  "/:id/options",
  requirePermission("organization.tasks.edit.all"),
  asyncHandler(async (req, res) => {
    const input = z.object({ options: z.array(optionSchema).min(1) }).parse(req.body);
    const t = await proposeVisitOptions({
      ticketId: req.params.id,
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      options: input.options,
    });
    return ok(res, serializeSchedule(t), "Datas enviadas ao cliente");
  })
);

// POST /api/assistance/:id/schedule  { startsAt, period } -> equipe marca direto (ex.: combinado por telefone)
router.post(
  "/:id/schedule",
  requirePermission("organization.tasks.edit.all"),
  asyncHandler(async (req, res) => {
    const input = optionSchema.parse(req.body);
    const t = await scheduleVisit({
      ticketId: req.params.id,
      scope: { organizationId: req.user!.organizationId },
      direct: input,
      actor: { kind: "STAFF", userId: req.user!.id },
    });
    return ok(res, serializeSchedule(t), "Visita agendada");
  })
);

// POST /api/assistance/:id/confirm -> equipe registra confirmação feita por telefone
router.post(
  "/:id/confirm",
  requirePermission("organization.tasks.edit.all"),
  asyncHandler(async (req, res) => {
    const exists = await prisma.assistanceTicket.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError("Chamado de assistência não encontrado");
    const t = await confirmVisit(exists.id, "EQUIPE");
    return ok(res, serializeSchedule(t), "Visita confirmada");
  })
);

export default router;
