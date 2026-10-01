/**
 * Promob → comercial. Toda importação que traz valores (XML ou PDF de
 * orçamento) vira um orçamento em rascunho do projeto, com os ambientes e o
 * custo de cada um e a margem padrão aplicada. Reimportou depois de mudar o
 * projeto no Promob? O mesmo rascunho é atualizado. Daí em diante segue o
 * fluxo normal: liberação se a pontuação ficar baixa, PDF, aceite do cliente
 * e, no aceite, os lançamentos no financeiro.
 */
import { prisma } from "../../prisma";
import { notifyUser } from "../../lib/notify";
import { computeQuote, type QuoteInput } from "./quote.rules";
import { calcToData, loadPricing, nextQuoteNumber } from "./quote.service";

export type ImportRoom = { room: string; cost: number; items: number; unpriced: number };

/** Ambientes da importação com o custo de cada um (subtotal do arquivo quando existe, senão a soma dos itens). */
export function roomsFromParsed(parsed: unknown): ImportRoom[] {
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as {
    itens?: { ambiente?: string | null; valorTotal?: number | null }[];
    valoresPorAmbiente?: { ambiente: string; valor: number }[];
  };
  const map = new Map<string, ImportRoom>();
  for (const it of p.itens ?? []) {
    const k = it.ambiente?.trim() || "Sem ambiente";
    const cur = map.get(k) ?? { room: k, cost: 0, items: 0, unpriced: 0 };
    const v = Number(it.valorTotal) || 0;
    cur.cost += v;
    cur.items++;
    if (!v) cur.unpriced++;
    map.set(k, cur);
  }
  for (const s of p.valoresPorAmbiente ?? []) {
    const cur = map.get(s.ambiente) ?? { room: s.ambiente, cost: 0, items: 0, unpriced: 0 };
    cur.cost = s.valor; // o subtotal do arquivo manda
    map.set(s.ambiente, cur);
  }
  return [...map.values()].map((r) => ({ ...r, cost: Math.round(r.cost * 100) / 100 }));
}

/** A importação serve para orçamento? Precisa ter algum valor. */
export const hasBudgetValues = (rooms: ImportRoom[]) => rooms.some((r) => r.cost > 0);

const desc = (r: ImportRoom) => `Móveis planejados — ${r.items} item(ns)${r.unpriced ? ` (${r.unpriced} sem preço no Promob)` : ""}`;

/**
 * Cria ou atualiza o rascunho de orçamento do projeto a partir da importação.
 * Nunca derruba a importação: devolve null se não der (sem valores, sem
 * vendedor) e deixa o motivo para quem chamou mostrar.
 */
export async function syncQuoteFromImport(importId: string, actorId: string | null): Promise<{ quoteId: string; number: string; created: boolean; total: number } | { skipped: string }> {
  const imp = await prisma.promobImport.findUnique({
    where: { id: importId },
    select: { id: true, organizationId: true, projectId: true, fileName: true, parsedJson: true, project: { select: { clientId: true, code: true, client: { select: { sellerId: true } } } } },
  });
  if (!imp) return { skipped: "importação não encontrada" };
  const rooms = roomsFromParsed(imp.parsedJson);
  if (!hasBudgetValues(rooms)) return { skipped: "o arquivo não traz valores (plano de corte ou itens sem preço): nada a levar para o orçamento" };
  const sellerId = actorId ?? imp.project.client.sellerId;
  if (!sellerId) return { skipped: "sem vendedor para assumir o orçamento (importação automática e cliente sem consultor)" };

  const config = await loadPricing();
  // rascunho que já veio do Promob neste projeto: é ele que se atualiza
  const existing = await prisma.commercialQuote.findFirst({
    where: { organizationId: imp.organizationId, projectId: imp.projectId, status: "DRAFT", promobImportId: { not: null } },
    include: { commissions: true },
    orderBy: { updatedAt: "desc" },
  });
  const seller = await prisma.user.findUnique({ where: { id: existing?.sellerId ?? sellerId }, select: { id: true, name: true } });
  if (!seller) return { skipped: "vendedor não encontrado" };

  const input: QuoteInput = {
    items: rooms.map((r) => ({ room: r.room, description: desc(r), unitCost: r.cost })),
    // reimportação mantém o que o vendedor já ajustou (margem, comissões, pagamento, frete, desconto)
    markup: existing ? Number(existing.markup) : config.defaultMarkup,
    commissions: existing
      ? existing.commissions.map((c) => ({ userId: c.userId, referrerId: c.referrerId, name: c.name, role: c.role, percent: Number(c.percent) }))
      : config.commissionRoles.filter((r) => r.role === "VENDEDOR" && r.defaultPercent > 0).map((r) => ({ userId: seller.id, name: seller.name, role: r.role, percent: r.defaultPercent })),
    discount: existing ? Number(existing.discount) : 0,
    freight: existing ? Number(existing.freight) : 0,
    otherCosts: existing ? Number(existing.otherCosts) : 0,
    payment: existing
      ? {
          method: existing.paymentMethod as QuoteInput["payment"]["method"],
          planId: config.financingPlans.some((p) => p.id === existing.financingPlanId) ? existing.financingPlanId : null,
          installments: existing.installments,
          downPayment: Number(existing.downPayment),
          feePercent: Number(existing.financingFeePercent),
        }
      : { method: "AVISTA" },
  };
  const c = computeQuote(input, config);
  const approval = { approvalStatus: c.needsApproval ? ("PENDING" as const) : ("NOT_REQUIRED" as const), approvalRequestedAt: c.needsApproval ? new Date() : null };

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.commercialQuoteItem.deleteMany({ where: { quoteId: existing.id } });
      await tx.commercialQuoteCommission.deleteMany({ where: { quoteId: existing.id } });
      await tx.commercialQuote.update({ where: { id: existing.id }, data: { promobImportId: imp.id, ...approval, ...calcToData(c) } });
    });
    await prisma.auditLog.create({ data: { userId: actorId, action: "QUOTE_UPDATED_FROM_PROMOB", entity: "CommercialQuote", entityId: existing.id, details: { importId: imp.id, file: imp.fileName, total: c.total } } });
    return { quoteId: existing.id, number: existing.number, created: false, total: c.total };
  }

  const opportunity = await prisma.commercialOpportunity.findFirst({
    where: { organizationId: imp.organizationId, clientId: imp.project.clientId, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const number = await nextQuoteNumber(imp.organizationId);
  const created = await prisma.commercialQuote.create({
    data: {
      organizationId: imp.organizationId,
      number,
      clientId: imp.project.clientId,
      projectId: imp.projectId,
      opportunityId: opportunity?.id ?? null,
      sellerId: seller.id,
      promobImportId: imp.id,
      validUntil: new Date(Date.now() + config.validityDays * 86_400_000),
      notes: null,
      ...approval,
      ...calcToData(c),
    },
    select: { id: true },
  });
  await prisma.auditLog.create({ data: { userId: actorId, action: "QUOTE_CREATED_FROM_PROMOB", entity: "CommercialQuote", entityId: created.id, details: { importId: imp.id, file: imp.fileName, number, total: c.total } } });
  if (seller.id !== actorId) await notifyUser(seller.id, `Orçamento ${number} criado do Promob`, `Projeto ${imp.project.code}: confira a margem e envie ao cliente.`);
  return { quoteId: created.id, number, created: true, total: c.total };
}
