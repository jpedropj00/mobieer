/**
 * Briefing do cliente (mesmas perguntas do Google Form original).
 *
 * O cliente se cadastra pelo site (nome, e-mail, CPF e senha), vira LEAD e
 * tem acesso só a responder este briefing. Quando a equipe completa o cadastro,
 * o acesso ao portal é ampliado.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { sendAutomation } from "../../lib/automations";
import { notifyUsersWithPermission } from "../../lib/notify";
import { prisma } from "../../prisma";
import { InvalidStateError, NotFoundError } from "../../utils/ApiError";

export const ENVIRONMENTS = [
  "Suíte Master", "Cozinha", "Sala", "Suíte Hóspede", "Suíte Filhos", "Banheiro",
  "Varanda", "Ambiente Corporativo", "Ambiente Comercial", "Área de Serviço", "Lavabo", "Outro",
] as const;
export const DISCOVERY_CHANNELS = ["Instagram", "Indicação", "Google", "Site", "Arquiteto", "Parceiros", "Outro"] as const;

/** Respostas do briefing (nome/e-mail/CPF já vêm do cadastro). */
export const briefingAnswersSchema = z.object({
  phone: z.string().trim().min(8, "Informe o telefone com DDD").max(30),
  address: z.string().trim().max(400).optional().nullable().or(z.literal("")),
  investment: z.string().trim().max(120).optional().nullable().or(z.literal("")),
  hasProject: z.boolean().default(false),
  environments: z.array(z.enum(ENVIRONMENTS)).max(20).default([]),
  userCount: z.coerce.number().int().min(0).max(999).optional().nullable(),
  discoveryChannel: z.enum(DISCOVERY_CHANNELS).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().nullable().or(z.literal("")),
});
export type BriefingAnswers = z.infer<typeof briefingAnswersSchema>;

/** "R$ 45.000", "45000", "45 mil" -> número quando der, senão só o texto. */
export function parseInvestment(v: string | null | undefined): { value: number | null; text: string | null } {
  if (!v || !v.trim()) return { value: null, text: null };
  const lower = v.toLowerCase();
  const thousand = /\bmil\b/.test(lower);
  const digits = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  let n = Number(digits);
  if (thousand && Number.isFinite(n) && n > 0 && n < 10000) n *= 1000;
  if (Number.isFinite(n) && n > 0) return { value: Math.round(n * 100) / 100, text: v.trim() };
  return { value: null, text: v.trim() };
}

export async function briefingForLead(leadId: string) {
  const lead = await prisma.commercialLead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, email: true, phone: true, document: true, status: true, briefing: true },
  });
  if (!lead) throw new NotFoundError("Cadastro não encontrado");
  const b = lead.briefing;
  return {
    status: lead.status,
    editable: lead.status !== "CONVERTED" && lead.status !== "LOST",
    submittedAt: b?.submittedAt ?? null,
    answers: {
      phone: lead.phone ?? "",
      address: b?.address ?? "",
      investment: b?.investmentText ?? (b?.investmentEstimate != null ? String(b.investmentEstimate) : ""),
      hasProject: b?.hasProject ?? false,
      environments: b?.environments ?? [],
      userCount: b?.userCount ?? null,
      discoveryChannel: b?.discoveryChannel ?? "",
      notes: b?.notes ?? "",
    },
    options: { environments: ENVIRONMENTS, discoveryChannels: DISCOVERY_CHANNELS },
  };
}

/** Salva as respostas. A primeira entrega avisa o comercial e responde no WhatsApp. */
export async function saveBriefing(leadId: string, input: BriefingAnswers) {
  const lead = await prisma.commercialLead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, status: true, organizationId: true, briefing: { select: { id: true } } },
  });
  if (!lead) throw new NotFoundError("Cadastro não encontrado");
  if (lead.status === "CONVERTED" || lead.status === "LOST") {
    throw new InvalidStateError("Seu briefing já foi recebido pela equipe e não pode mais ser alterado por aqui");
  }

  const inv = parseInvestment(input.investment);
  const data = {
    address: input.address || null,
    investmentEstimate: inv.value === null ? null : new Prisma.Decimal(inv.value.toFixed(2)),
    investmentText: inv.text,
    hasProject: input.hasProject,
    environments: input.environments,
    userCount: input.userCount ?? null,
    discoveryChannel: input.discoveryChannel || null,
    notes: input.notes || null,
  };
  const firstTime = !lead.briefing;

  await prisma.$transaction([
    prisma.commercialLead.update({
      where: { id: lead.id },
      data: {
        phone: input.phone,
        interest: input.environments.length ? input.environments.join(", ") : null,
        source: input.discoveryChannel || undefined,
      },
    }),
    prisma.leadBriefing.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, origin: "PUBLIC", ...data },
      update: { ...data, submittedAt: new Date() },
    }),
  ]);

  if (firstTime) {
    await prisma.auditLog.create({
      data: { action: "BRIEFING_SUBMITTED", entity: "CommercialLead", entityId: lead.id, details: { name: lead.name, channel: input.discoveryChannel } },
    });
    await notifyUsersWithPermission({
      organizationId: lead.organizationId,
      permission: "commercial.leads.manage",
      title: "Novo briefing recebido",
      message: `${lead.name} respondeu o briefing${input.environments.length ? ` (${input.environments.join(", ")})` : ""}. Complete o cadastro para liberar o portal.`,
    });
    await sendAutomation("LEAD_RECEIVED", {
      organizationId: lead.organizationId,
      leadId: lead.id,
      phone: input.phone,
      name: lead.name,
      dedupeKey: `lead-received:${lead.id}`,
    });
  }
  return { firstTime };
}
