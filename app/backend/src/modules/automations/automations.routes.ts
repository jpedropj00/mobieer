import { Router } from "express";
import { z } from "zod";
import { MessageEvent, MessageStatus } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { AUTOMATION_DEFAULTS, MESSAGE_EVENTS, getAutomation } from "../../lib/automations";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidationError } from "../../utils/ApiError";
import { enumQuery, intQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { renderTemplate, templateKeys } from "../../utils/template";

/** Configuração das mensagens automáticas: /api/automations */
const router = Router();
router.use(authenticate);

const EXAMPLES: Record<string, string> = {
  "cliente.nome": "Maria Souza",
  "cliente.primeiroNome": "Maria",
  "empresa.nome": "MOBIEER",
  "portal.link": `${env.appUrl}${env.portal.path}`,
  "projeto.codigo": "364-1",
  "projeto.nome": "Cozinha e dormitórios",
  "medicao.data": "18/09 (quinta) às 09:00",
  "producao.etapa": "Em produção",
  "assistencia.numero": "AST-00012",
  "assistencia.titulo": "Porta desalinhada",
  "assistencia.datas": "• 18/09 (quinta) pela manhã\n• 19/09 (sexta) à tarde",
  "assistencia.data": "18/09 (quinta) pela manhã",
  "assistencia.linkConfirmacao": `${env.appUrl}/confirmar-visita/abc123`,
  "parcela.valor": "R$ 4.500,00",
  "parcela.vencimento": "25/09 (quinta)",
  "recibo.numero": "REC-8F2A91C0",
  "recibo.valor": "R$ 4.500,00",
};

// GET /api/automations -> todas, com o texto efetivo e um exemplo renderizado
router.get(
  "/",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const list = await Promise.all(MESSAGE_EVENTS.map((e) => getAutomation(req.user!.organizationId, e)));
    return ok(res, {
      automations: list.map((a) => ({ ...a, defaultBody: AUTOMATION_DEFAULTS[a.event].body, preview: renderTemplate(a.body, EXAMPLES).text })),
    });
  })
);

// PUT /api/automations/:event
router.put(
  "/:event",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const event = enumQuery(req.params.event, MessageEvent, "evento")!;
    const input = z
      .object({
        enabled: z.boolean(),
        body: z.string().trim().min(5).max(1500),
        metaTemplateName: z.string().trim().max(120).regex(/^[a-z0-9_]*$/, "Use só letras minúsculas, números e _").optional().nullable(),
        delayDays: z.coerce.number().int().min(0).max(90).optional(),
      })
      .parse(req.body);

    const allowed = new Set(AUTOMATION_DEFAULTS[event].vars);
    const unknown = templateKeys(input.body).filter((k) => !allowed.has(k));
    if (unknown.length) {
      throw new ValidationError(`Marcador não disponível para esta mensagem: ${unknown.map((k) => `{{${k}}}`).join(", ")}`, {
        unknown,
        allowed: [...allowed],
      });
    }

    await prisma.messageAutomation.upsert({
      where: { organizationId_event: { organizationId: req.user!.organizationId, event } },
      create: {
        organizationId: req.user!.organizationId,
        event,
        enabled: input.enabled,
        body: input.body,
        metaTemplateName: input.metaTemplateName || null,
        delayDays: input.delayDays ?? AUTOMATION_DEFAULTS[event].delayDays ?? 0,
        updatedById: req.user!.id,
      },
      update: {
        enabled: input.enabled,
        body: input.body,
        metaTemplateName: input.metaTemplateName || null,
        delayDays: input.delayDays,
        updatedById: req.user!.id,
      },
    });
    const a = await getAutomation(req.user!.organizationId, event);
    return ok(res, { ...a, defaultBody: AUTOMATION_DEFAULTS[event].body, preview: renderTemplate(a.body, EXAMPLES).text }, "Mensagem salva");
  })
);

// DELETE /api/automations/:event -> volta ao texto padrão
router.delete(
  "/:event",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const event = enumQuery(req.params.event, MessageEvent, "evento")!;
    await prisma.messageAutomation.deleteMany({ where: { organizationId: req.user!.organizationId, event } });
    const a = await getAutomation(req.user!.organizationId, event);
    return ok(res, { ...a, defaultBody: AUTOMATION_DEFAULTS[event].body, preview: renderTemplate(a.body, EXAMPLES).text }, "Texto padrão restaurado");
  })
);

export default router;
