/**
 * Painel da operação: clientes, vendas, chapas, ATs, produção e montagem num
 * lugar só, para a TV da "sala de controle". Tudo sai dos dados reais do
 * período; nada é guardado.
 */
import { prisma } from "../../prisma";
import { bucketKeys, isSheetProduct, periodRange, series, sheetsFor, type Period } from "./operation.rules";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const OPEN_AT = ["OPEN", "TRIAGE", "SCHEDULED", "IN_PROGRESS", "WAITING_CLIENT"] as const;
const AT_LABEL: Record<string, string> = {
  OPEN: "Aberta",
  TRIAGE: "Triagem",
  SCHEDULED: "Visita marcada",
  IN_PROGRESS: "Em atendimento",
  WAITING_CLIENT: "Aguardando cliente",
};
const STAGE_LABEL: Record<string, string> = {
  RELEASED: "Liberado",
  IN_PRODUCTION: "Em produção",
  PRE_ASSEMBLY: "Pré-montagem",
  OUT_FOR_DELIVERY: "Saiu p/ entrega",
};

export async function operationDashboard(organizationId: string, period: Period, now = new Date()) {
  const r = periodRange(period, now);
  const inPeriod = { gte: r.start, lt: r.end };
  const org = { organizationId };

  const [
    newClients,
    activeClients,
    newLeads,
    won,
    lost,
    openOpps,
    quotesApproved,
    quotesOpen,
    sheetExits,
    releasedOrders,
    atOpened,
    atResolved,
    atOpenNow,
    ordersByStage,
    delivered,
    workDone,
    workNext,
  ] = await Promise.all([
    prisma.client.count({ where: { ...org, createdAt: inPeriod } }),
    prisma.client.count({ where: { ...org, status: "ACTIVE" } }),
    prisma.commercialLead.count({ where: { ...org, createdAt: inPeriod } }),
    prisma.commercialOpportunity.findMany({
      where: { ...org, status: "WON", wonAt: inPeriod },
      select: { estimatedValue: true, wonAt: true, seller: { select: { id: true, name: true } } },
    }),
    prisma.commercialOpportunity.count({ where: { ...org, status: "LOST", updatedAt: inPeriod } }),
    prisma.commercialOpportunity.aggregate({ where: { ...org, status: "OPEN" }, _count: true, _sum: { estimatedValue: true } }),
    prisma.commercialQuote.count({ where: { ...org, status: "APPROVED", approvedAt: inPeriod } }),
    prisma.commercialQuote.count({ where: { ...org, status: { in: ["DRAFT", "SENT", "VIEWED", "NEGOTIATION"] } } }),
    // chapas que saíram do estoque (o almoxarifado ainda não separa por organização)
    prisma.stockMovement.findMany({ where: { type: "EXIT", date: inPeriod }, select: { quantity: true, date: true, product: { select: { name: true } } } }),
    // projetos que entraram em produção no período: m² das peças do Promob
    prisma.productionOrder.findMany({
      where: { ...org, releasedAt: inPeriod },
      select: { project: { select: { promobImports: { where: { status: "PARSED" }, orderBy: { createdAt: "desc" }, take: 5, select: { parsedJson: true } } } } },
    }),
    prisma.assistanceTicket.findMany({ where: { ...org, createdAt: inPeriod }, select: { createdAt: true, problemType: true } }),
    prisma.assistanceTicket.findMany({ where: { ...org, resolvedAt: inPeriod }, select: { createdAt: true, resolvedAt: true } }),
    prisma.assistanceTicket.groupBy({ by: ["status"], where: { ...org, status: { in: [...OPEN_AT] } }, _count: true }),
    prisma.productionOrder.groupBy({ by: ["stage"], where: { ...org, stage: { not: "DELIVERED" } }, _count: true }),
    prisma.productionOrder.count({ where: { ...org, deliveredAt: inPeriod } }),
    prisma.installationWorkOrder.count({ where: { ...org, status: "DONE", completedAt: inPeriod } }),
    prisma.installationWorkOrder.count({ where: { ...org, status: "OPEN", scheduledFor: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) } } }),
  ]);

  const keys = bucketKeys(r.start, r.end, r.bucket);
  const soldValue = won.reduce((s, o) => s + n(o.estimatedValue), 0);

  // ranking de vendedores pelo valor vendido
  const bySeller = new Map<string, { name: string; value: number; count: number }>();
  for (const o of won) {
    const cur = bySeller.get(o.seller.id) ?? { name: o.seller.name, value: 0, count: 0 };
    cur.value += n(o.estimatedValue);
    cur.count++;
    bySeller.set(o.seller.id, cur);
  }

  const sheetRows = sheetExits.filter((m) => isSheetProduct(m.product.name));
  const sheetsUsed = sheetRows.reduce((s, m) => s + m.quantity, 0);
  // Chapas previstas: o plano de corte (PDF) e o CSV do plugin já trazem as chapas por material;
  // sem isso, estima pela área das peças.
  let pieceArea = 0;
  let plannedSheets = 0;
  for (const o of releasedOrders) {
    const parsed = o.project.promobImports.map((i) => i.parsedJson as { pecas?: { areaM2?: number | null }[]; materiais?: { areaM2?: number; chapas?: number | null }[] } | null).find((x) => x?.materiais?.length || x?.pecas?.length);
    if (!parsed) continue;
    const area = parsed.materiais?.length ? parsed.materiais.reduce((a, m) => a + (Number(m.areaM2) || 0), 0) : (parsed.pecas ?? []).reduce((a, x) => a + (Number(x.areaM2) || 0), 0);
    pieceArea += area;
    const real = (parsed.materiais ?? []).reduce((a, m) => a + (Number(m.chapas) || 0), 0);
    plannedSheets += real || sheetsFor(area);
  }

  const resolveDays = atResolved.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 86_400_000);
  const problemTypes = new Map<string, number>();
  for (const t of atOpened) problemTypes.set(t.problemType || "Não informado", (problemTypes.get(t.problemType || "Não informado") ?? 0) + 1);

  return {
    period: { key: period, label: r.label, from: r.start, to: r.end, bucket: r.bucket },
    generatedAt: now,
    clients: { new: newClients, active: activeClients, newLeads },
    sales: {
      contracts: won.length,
      value: Math.round(soldValue * 100) / 100,
      avgTicket: won.length ? Math.round((soldValue / won.length) * 100) / 100 : 0,
      conversion: won.length + lost ? Math.round((won.length / (won.length + lost)) * 100) : null,
      quotesApproved,
      quotesOpen,
      pipeline: { count: openOpps._count, value: n(openOpps._sum.estimatedValue) },
      series: series(keys, won.map((o) => ({ at: o.wonAt!, value: n(o.estimatedValue) })), r.bucket),
      countSeries: series(keys, won.map((o) => ({ at: o.wonAt!, value: 1 })), r.bucket),
      ranking: [...bySeller.values()].sort((a, b) => b.value - a.value).slice(0, 5).map((s) => ({ ...s, value: Math.round(s.value * 100) / 100 })),
    },
    sheets: {
      used: sheetsUsed,
      usedSeries: series(keys, sheetRows.map((m) => ({ at: m.date, value: m.quantity })), r.bucket),
      plannedArea: Math.round(pieceArea * 100) / 100,
      planned: plannedSheets,
      projectsReleased: releasedOrders.length,
    },
    assistance: {
      opened: atOpened.length,
      resolved: atResolved.length,
      openNow: atOpenNow.reduce((s, g) => s + g._count, 0),
      avgResolveDays: resolveDays.length ? Math.round((resolveDays.reduce((s, d) => s + d, 0) / resolveDays.length) * 10) / 10 : null,
      byStatus: OPEN_AT.map((s) => ({ key: s, label: AT_LABEL[s], value: atOpenNow.find((g) => g.status === s)?._count ?? 0 })),
      byProblem: [...problemTypes.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5),
      openedSeries: series(keys, atOpened.map((t) => ({ at: t.createdAt, value: 1 })), r.bucket),
    },
    production: {
      byStage: Object.keys(STAGE_LABEL).map((s) => ({ key: s, label: STAGE_LABEL[s], value: ordersByStage.find((g) => g.stage === s)?._count ?? 0 })),
      delivered,
    },
    installation: { done: workDone, next7days: workNext },
  };
}
