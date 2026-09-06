import { prisma } from "../../prisma";

const DAY = 86400000;

/**
 * Job diário: cobra o consultor de oportunidades paradas.
 * Gatilhos: próxima ação vencida OU sem interação há 7+ dias (e criada há 3+ dias).
 */
export async function runCommercialFollowupAlerts() {
  const now = new Date();
  const staleCut = new Date(now.getTime() - 7 * DAY);
  const bornCut = new Date(now.getTime() - 3 * DAY);

  const opps = await prisma.commercialOpportunity.findMany({
    where: { status: { notIn: ["WON", "LOST"] }, createdAt: { lte: bornCut } },
    select: {
      id: true, title: true, sellerId: true, nextAction: true, nextActionAt: true,
      interactions: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });

  const bySeller = new Map<string, string[]>();
  for (const o of opps) {
    const last = o.interactions[0]?.occurredAt;
    const overdue = o.nextActionAt && o.nextActionAt < now;
    const stale = !last || last < staleCut;
    if (!overdue && !stale) continue;
    const arr = bySeller.get(o.sellerId) ?? [];
    arr.push(`${o.title}${overdue ? " (ação vencida)" : " (sem contato)"}`);
    bySeller.set(o.sellerId, arr);
  }

  let created = 0;
  for (const [sellerId, items] of bySeller) {
    const recent = await prisma.notification.findFirst({
      where: { userId: sellerId, type: "INFO", title: "Follow-up comercial", createdAt: { gte: new Date(now.getTime() - DAY) } },
      select: { id: true },
    });
    if (recent) continue;
    await prisma.notification.create({
      data: {
        type: "INFO",
        title: "Follow-up comercial",
        message: `${items.length} oportunidade(s) precisam de atualização. Ex.: ${items.slice(0, 3).join("; ")}`,
        userId: sellerId,
      },
    });
    created++;
  }
  return { sellersNotified: created };
}
