import { Router } from "express";
import { z } from "zod";
import { MessageEvent, MessageStatus } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { AUTOMATION_DEFAULTS, MESSAGE_EVENTS, getAutomation } from "../../lib/automations";
import { sendWhatsAppText, toWhatsAppNumber } from "../../lib/whatsapp";
import { env } from "../../config/env";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidationError } from "../../utils/ApiError";
import { enumQuery, intQuery } from "../../utils/query";
import { ok } from "../../utils/response";
import { renderTemplate, templateKeys } from "../../utils/template";
import { whatsappStatus } from "../../lib/whatsapp-status";

/** Configuração das mensagens automáticas: /api/automations */
const router = Router();
router.use(authenticate);

const EXAMPLES: Record<string, string> = {
  "cliente.nome": "Maria Souza",
  "cliente.primeiroNome": "Maria",
  "empresa.nome": "MOBIEER",
  "portal.link": "https://mobieer.vercel.app/portal",
  "projeto.codigo": "364-1",
  "projeto.nome": "Cozinha e dormitórios",
  "medicao.data": "18/09 (quinta) às 09:00",
  "producao.etapa": "Em produção",
  "assistencia.numero": "AST-00012",
  "assistencia.titulo": "Porta desalinhada",
  "assistencia.datas": "• 18/09 (quinta) pela manhã\n• 19/09 (sexta) à tarde",
  "assistencia.data": "18/09 (quinta) pela manhã",
  "assistencia.linkConfirmacao": "https://mobieer.vercel.app/confirmar-visita/abc123",
};

// GET /api/automations -> todas, com o texto efetivo e um exemplo renderizado
router.get(
  "/",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const list = await Promise.all(MESSAGE_EVENTS.map((e) => getAutomation(req.user!.organizationId, e)));
    return ok(res, {
      whatsappConfigured: env.whatsapp.enabled,
      automations: list.map((a) => ({ ...a, defaultBody: AUTOMATION_DEFAULTS[a.event].body, preview: renderTemplate(a.body, EXAMPLES).text })),
    });
  })
);

// GET /api/automations/whatsapp/status -> numero conectado, templates e avisos
router.get(
  "/whatsapp/status",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => ok(res, await whatsappStatus()))
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

// POST /api/automations/:event/test { phone } -> envia o exemplo para um número
router.post(
  "/:event/test",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const event = enumQuery(req.params.event, MessageEvent, "evento")!;
    const { phone } = z.object({ phone: z.string().trim().min(8).max(30) }).parse(req.body);
    if (!toWhatsAppNumber(phone)) throw new ValidationError("Telefone inválido — inclua o DDD");
    const a = await getAutomation(req.user!.organizationId, event);
    const r = await sendWhatsAppText(phone, `[TESTE] ${renderTemplate(a.body, EXAMPLES).text}`);
    return ok(
      res,
      r,
      r.delivered ? "Mensagem de teste enviada" : r.skipped ? "WhatsApp não configurado: a mensagem saiu só no log do servidor" : `Falha: ${r.error}`
    );
  })
);

// GET /api/automations/logs?event=&status=&limit=
router.get(
  "/logs",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.messageLog.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(req.query.event ? { event: enumQuery(req.query.event, MessageEvent, "evento") } : {}),
        ...(req.query.status ? { status: enumQuery(req.query.status, MessageStatus, "status") } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: intQuery(req.query.limit, { min: 1, max: 200, name: "limit" }) ?? 50,
    });
    const clientIds = [...new Set(rows.map((r) => r.clientId).filter((x): x is string => Boolean(x)))];
    const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } });
    const names = new Map(clients.map((c) => [c.id, c.name]));
    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        event: r.event,
        label: AUTOMATION_DEFAULTS[r.event].label,
        status: r.status,
        to: r.to ? `•••${r.to.slice(-4)}` : null,
        clientName: r.clientId ? names.get(r.clientId) ?? null : null,
        body: r.body,
        error: r.error,
        createdAt: r.createdAt,
      }))
    );
  })
);

export default router;
