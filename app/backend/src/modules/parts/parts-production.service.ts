/**
 * Solicitação de peças → produção.
 *
 * Quando a solicitação passa para "Em produção", cada peça pedida vira um item
 * na fábrica (no pedido de produção do projeto), com etiqueta e setores, como
 * qualquer outro item. Quando todos esses itens têm baixa, a solicitação passa
 * sozinha para "Pronta". Nada do fluxo que já existia muda: quem preferir
 * continua mudando o status à mão.
 */
import { PartRequestStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { notifyUser } from "../../lib/notify";
import { ensureCodes } from "../production/labels.service";
import { getOrCreateOrder } from "../production/production.service";
import { partItemMeasures } from "./parts-production.rules";

export type SentToProduction = { created: number; reason: string | null };

/** Cria os itens da fábrica para as peças da solicitação. Não duplica se já foram criados. */
export async function sendPartRequestToProduction(partRequestId: string, organizationId: string, userId: string | null): Promise<SentToProduction> {
  const r = await prisma.partRequest.findFirst({
    where: { id: partRequestId, organizationId },
    select: { id: true, number: true, title: true, roomLabel: true, projectId: true, items: { orderBy: { createdAt: "asc" } }, _count: { select: { productionItems: true } } },
  });
  if (!r) return { created: 0, reason: "Solicitação não encontrada" };
  if (r._count.productionItems > 0) return { created: 0, reason: null };
  if (!r.projectId) return { created: 0, reason: "A solicitação não está ligada a um projeto, então não entrou na fábrica. Vincule um projeto para as peças aparecerem na produção." };
  if (!r.items.length) return { created: 0, reason: "A solicitação não tem peças." };

  let orderId: string;
  try {
    orderId = (await getOrCreateOrder(r.projectId, organizationId, userId)).id;
  } catch (e) {
    return { created: 0, reason: e instanceof Error ? e.message : "Não foi possível abrir o pedido de produção do projeto." };
  }

  const last = await prisma.productionItem.findFirst({ where: { orderId }, orderBy: { position: "desc" }, select: { position: true } });
  let position = (last?.position ?? 0) + 1;
  await prisma.productionItem.createMany({
    data: r.items.map((it) => ({
      organizationId,
      orderId,
      partRequestId: r.id,
      ambiente: r.roomLabel,
      descricao: it.name,
      referencia: it.code || r.number,
      quantidade: it.quantity,
      material: [it.material, it.color].filter(Boolean).join(" ") || null,
      medidas: partItemMeasures(it),
      fita: it.finish,
      modulo: `Reposição ${r.number}`,
      notes: [`Peça de reposição — solicitação ${r.number}`, it.description, it.notes].filter(Boolean).join(" · "),
      position: position++,
    })),
  });
  await ensureCodes(organizationId, orderId);
  return { created: r.items.length, reason: null };
}

/**
 * Chamado quando um item da fábrica recebe baixa. Se ele veio de uma
 * solicitação de peças e era o último pendente, a solicitação fica "Pronta".
 */
export async function syncPartRequestFromItem(itemId: string, userId: string | null) {
  const item = await prisma.productionItem.findUnique({ where: { id: itemId }, select: { partRequestId: true } });
  if (!item?.partRequestId) return;
  const pending = await prisma.productionItem.count({ where: { partRequestId: item.partRequestId, status: { notIn: ["DONE", "CANCELLED"] } } });
  if (pending > 0) return;
  const r = await prisma.partRequest.findUnique({ where: { id: item.partRequestId }, select: { id: true, number: true, title: true, status: true, createdById: true, contractor: { select: { userId: true } } } });
  if (!r || r.status !== PartRequestStatus.EM_PRODUCAO) return;
  await prisma.$transaction([
    prisma.partRequest.update({ where: { id: r.id }, data: { status: PartRequestStatus.PRONTA } }),
    prisma.partRequestHistory.create({ data: { partRequestId: r.id, userId, fromStatus: PartRequestStatus.EM_PRODUCAO, toStatus: PartRequestStatus.PRONTA, note: "Todas as peças tiveram baixa na fábrica" } }),
  ]);
  const to = r.contractor?.userId ?? r.createdById;
  if (to && to !== userId) await notifyUser(to, `Solicitação ${r.number}: Pronta`, r.title).catch(() => undefined);
}
