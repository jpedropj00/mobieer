import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError } from "../../utils/ApiError";
import { ok } from "../../utils/response";

/**
 * Briefing público do cliente — mesmo conteúdo do Google Form.
 * Sem autenticação: qualquer pessoa com o link preenche e vira um lead no CRM.
 */
const router = Router();

export const ENVIRONMENTS = [
  "Suíte Master", "Cozinha", "Sala", "Suíte Hóspede", "Suíte Filhos", "Banheiro",
  "Varanda", "Ambiente Corporativo", "Ambiente Comercial", "Área de Serviço", "Lavabo", "Outro",
] as const;
export const DISCOVERY_CHANNELS = ["Instagram", "Indicação", "Google", "Site", "Arquiteto", "Parceiros", "Outro"] as const;

const briefingSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().email().optional().nullable().or(z.literal("")),
  phone: z.string().trim().min(8).max(30),
  address: z.string().trim().max(400).optional().nullable().or(z.literal("")),
  investment: z.string().trim().max(120).optional().nullable().or(z.literal("")),
  hasProject: z.boolean().default(false),
  environments: z.array(z.string().trim().max(60)).max(20).default([]),
  userCount: z.coerce.number().int().min(0).max(999).optional().nullable(),
  discoveryChannel: z.string().trim().max(60).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
});

/** "R$ 45.000", "45000", "45 mil" -> número quando der, senão null. */
function parseInvestment(v: string | null | undefined): { value: Prisma.Decimal | null; text: string | null } {
  if (!v) return { value: null, text: null };
  const digits = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(digits);
  if (Number.isFinite(n) && n > 0) return { value: new Prisma.Decimal(n.toFixed(2)), text: v };
  return { value: null, text: v };
}

// Metadados do formulário (para o frontend montar a tela)
router.get("/meta", (_req, res) =>
  res.json({ success: true, data: { environments: ENVIRONMENTS, discoveryChannels: DISCOVERY_CHANNELS } })
);

// POST /api/briefing  — público
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = briefingSchema.parse(req.body);
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!org) throw new BadRequestError("Organização não configurada");

    const inv = parseInvestment(input.investment);

    const lead = await prisma.commercialLead.create({
      data: {
        organizationId: org.id,
        name: input.name,
        email: input.email || null,
        phone: input.phone,
        source: input.discoveryChannel || "Briefing",
        interest: input.environments.length ? input.environments.join(", ") : null,
        status: "NEW",
        notes: input.notes || null,
        briefing: {
          create: {
            address: input.address || null,
            investmentEstimate: inv.value,
            investmentText: inv.text,
            hasProject: input.hasProject,
            environments: input.environments,
            userCount: input.userCount ?? null,
            discoveryChannel: input.discoveryChannel || null,
            notes: input.notes || null,
            origin: "PUBLIC",
          },
        },
      },
      select: { id: true },
    });

    await prisma.auditLog.create({
      data: { action: "BRIEFING_SUBMITTED", entity: "CommercialLead", entityId: lead.id, details: { name: input.name, channel: input.discoveryChannel } },
    });

    return ok(res, { received: true }, "Briefing recebido. Em breve entraremos em contato.");
  })
);

export default router;
