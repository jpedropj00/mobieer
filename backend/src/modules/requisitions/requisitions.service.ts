import { InspectionResult, MovementType, Prisma, RequisitionItemStatus, RequisitionStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/ApiError";
import { nextCode } from "../../utils/helpers";
import type { CreateRequisitionInput, ReservationInput, UpdateRequisitionInput } from "./requisitions.schema";

const STATUS_LABEL: Record<RequisitionStatus, string> = {
  DRAFT: "Rascunho", REQUESTED: "Solicitada", IN_REVIEW: "Em análise", WAITING_MATERIAL: "Aguardando material",
  RELEASED: "Liberada para corte", IN_CUTTING: "Em corte", INSPECTION: "Conferência", COMPLETED: "Concluída", CANCELLED: "Cancelada",
};

const include = {
  requester: { select: { id: true, name: true, sector: true, position: true } },
  approvedBy: { select: { id: true, name: true } }, responsible: { select: { id: true, name: true } },
  cutter: { select: { id: true, name: true } }, inspector: { select: { id: true, name: true } },
  items: { include: { product: { select: { id: true, name: true, code: true, unit: true, stock: true, reservedStock: true } }, reservations: { where: { status: ReservationStatus.ACTIVE }, select: { id: true, quantity: true, status: true } } } },
  history: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" as const } },
  attachments: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.RequisitionInclude;

type FullRequisition = Prisma.RequisitionGetPayload<{ include: typeof include }>;

function serialize(r: FullRequisition) {
  const totalQty = r.items.reduce((sum, item) => sum + item.quantity, 0);
  const completedQty = r.items.reduce((sum, item) => sum + (item.status === "CUT" || item.status === "INSPECTED" ? item.quantity : 0), 0);
  return {
    ...r, statusLabel: STATUS_LABEL[r.status], itemCount: r.items.length, totalQty, completedQty,
    progress: totalQty ? Math.round((completedQty / totalQty) * 100) : 0,
    overdue: Boolean(r.neededAt && r.neededAt < new Date() && !(r.status === RequisitionStatus.COMPLETED || r.status === RequisitionStatus.CANCELLED)),
    items: r.items.map((item) => ({
      ...item, thickness: item.thickness === null ? null : Number(item.thickness), length: item.length === null ? null : Number(item.length), width: item.width === null ? null : Number(item.width),
      reservedQuantity: item.reservations.reduce((sum, reservation) => sum + reservation.quantity, 0),
      availability: item.product ? { physical: item.product.stock, reserved: item.product.reservedStock, available: Math.max(0, item.product.stock - item.product.reservedStock), situation: item.product.stock - item.product.reservedStock >= item.quantity ? "AVAILABLE" : item.product.stock - item.product.reservedStock > 0 ? "PARTIAL" : "UNAVAILABLE" } : null,
    })),
  };
}

async function requireRequisition(id: string) {
  const requisition = await prisma.requisition.findUnique({ where: { id }, include });
  if (!requisition) throw new NotFoundError("Requisição não encontrada");
  return requisition;
}

async function logHistory(tx: Prisma.TransactionClient, requisitionId: string, userId: string, action: string, fromValue?: Prisma.InputJsonValue, toValue?: Prisma.InputJsonValue, note?: string | null) {
  await Promise.all([
    tx.requisitionHistory.create({ data: { requisitionId, userId, action, fromValue, toValue, note: note ?? null } }),
    tx.auditLog.create({ data: { userId, action, entity: "Requisition", entityId: requisitionId, details: { from: fromValue, to: toValue, note } } }),
  ]);
}

export async function listRequisitions(params: { page: number; perPage: number; status?: RequisitionStatus; priority?: string; search?: string; userId?: string; overdue?: boolean; sort?: string }) {
  const where: Prisma.RequisitionWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.priority) where.priority = params.priority as never;
  if (params.userId) where.requesterId = params.userId;
  if (params.overdue) where.AND = [{ neededAt: { lt: new Date() } }, { status: { notIn: [RequisitionStatus.COMPLETED, RequisitionStatus.CANCELLED] } }];
  if (params.search) where.OR = [{ number: { contains: params.search, mode: "insensitive" } }, { clientName: { contains: params.search, mode: "insensitive" } }, { projectReference: { contains: params.search, mode: "insensitive" } }, { requester: { name: { contains: params.search, mode: "insensitive" } } }, { items: { some: { description: { contains: params.search, mode: "insensitive" } } } }];
  const orderBy: Prisma.RequisitionOrderByWithRelationInput[] = params.sort === "oldest" ? [{ createdAt: "asc" }] : params.sort === "deadline" ? [{ neededAt: "asc" }] : params.sort === "priority" ? [{ priority: "desc" }, { neededAt: "asc" }] : [{ createdAt: "desc" }];
  const [total, rows] = await prisma.$transaction([prisma.requisition.count({ where }), prisma.requisition.findMany({ where, include, orderBy, skip: (params.page - 1) * params.perPage, take: params.perPage })]);
  return { items: rows.map(serialize), meta: { page: params.page, perPage: params.perPage, total, pages: Math.max(1, Math.ceil(total / params.perPage)) } };
}

export async function getRequisition(id: string) { return serialize(await requireRequisition(id)); }

export async function getIndicators(userId?: string) {
  const now = new Date();
  const scope = userId ? { requesterId: userId } : {};
  const grouped = await prisma.requisition.groupBy({ by: ["status"], where: scope, _count: true });
  const count = Object.fromEntries(grouped.map((row) => [row.status, row._count]));
  const overdue = await prisma.requisition.count({ where: { ...scope, neededAt: { lt: now }, status: { notIn: [RequisitionStatus.COMPLETED, RequisitionStatus.CANCELLED] } } });
  return { open: Object.entries(count).filter(([status]) => !["COMPLETED", "CANCELLED"].includes(status)).reduce((sum, [, value]) => sum + value, 0), inReview: count.IN_REVIEW ?? 0, waitingMaterial: count.WAITING_MATERIAL ?? 0, released: count.RELEASED ?? 0, inCutting: count.IN_CUTTING ?? 0, inspection: count.INSPECTION ?? 0, completed: count.COMPLETED ?? 0, overdue };
}

function itemData(item: CreateRequisitionInput["items"][number]) { return { description: item.description, material: item.material ?? null, productId: item.productId ?? null, thickness: item.thickness ?? null, length: item.length ?? null, width: item.width ?? null, quantity: item.quantity, unit: item.unit, edgeFinish: item.edgeFinish ?? null, note: item.note ?? null }; }

export async function createRequisition(input: CreateRequisitionInput, requesterId: string) {
  const number = await nextCode("requisition", "REQ");
  const created = await prisma.$transaction(async (tx) => {
    const req = await tx.requisition.create({ data: { number, sector: input.sector ?? null, destination: input.destination ?? null, clientName: input.clientName ?? null, projectReference: input.projectReference ?? null, priority: input.priority, neededAt: input.neededAt ? new Date(input.neededAt) : null, responsibleId: input.responsibleId ?? null, note: input.note ?? null, requesterId, status: input.submit ? RequisitionStatus.REQUESTED : RequisitionStatus.DRAFT, submittedAt: input.submit ? new Date() : null, items: { create: input.items.map(itemData) }, attachments: { create: input.attachments.map((a) => ({ name: a.name, url: a.url, mimeType: a.mimeType ?? null, size: a.size ?? null })) } }, include });
    await logHistory(tx, req.id, requesterId, input.submit ? "REQUISITION_SUBMITTED" : "REQUISITION_CREATED", undefined, { number, itemCount: input.items.length });
    return req;
  });
  return serialize(created);
}

export async function updateRequisition(id: string, input: UpdateRequisitionInput, actorId: string, permissions: string[]) {
  const current = await requireRequisition(id);
  if (current.status !== RequisitionStatus.DRAFT) throw new BadRequestError("Somente rascunhos podem ser editados");
  if (current.requesterId !== actorId && !permissions.includes("requisitions.edit.all")) throw new ForbiddenError("Você só pode editar seus próprios rascunhos");
  const updated = await prisma.$transaction(async (tx) => {
    if (input.items) { await tx.requisitionItem.deleteMany({ where: { requisitionId: id } }); await tx.requisitionItem.createMany({ data: input.items.map((item) => ({ ...itemData(item), requisitionId: id })) }); }
    const req = await tx.requisition.update({ where: { id }, data: { sector: input.sector, destination: input.destination, clientName: input.clientName, projectReference: input.projectReference, priority: input.priority, neededAt: input.neededAt === undefined ? undefined : input.neededAt ? new Date(input.neededAt) : null, responsibleId: input.responsibleId, note: input.note }, include });
    await logHistory(tx, id, actorId, "REQUISITION_UPDATED", { updatedAt: current.updatedAt.toISOString() }, { items: input.items?.length });
    return req;
  });
  return serialize(updated);
}

const TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  DRAFT: [RequisitionStatus.REQUESTED, RequisitionStatus.CANCELLED], REQUESTED: [RequisitionStatus.IN_REVIEW, RequisitionStatus.CANCELLED],
  IN_REVIEW: [RequisitionStatus.WAITING_MATERIAL, RequisitionStatus.RELEASED, RequisitionStatus.CANCELLED], WAITING_MATERIAL: [RequisitionStatus.IN_REVIEW, RequisitionStatus.RELEASED, RequisitionStatus.CANCELLED],
  RELEASED: [RequisitionStatus.IN_CUTTING, RequisitionStatus.CANCELLED], IN_CUTTING: [RequisitionStatus.INSPECTION, RequisitionStatus.CANCELLED],
  INSPECTION: [RequisitionStatus.IN_CUTTING, RequisitionStatus.COMPLETED, RequisitionStatus.CANCELLED], COMPLETED: [], CANCELLED: [],
};
const REQUIRED_PERMISSION: Partial<Record<RequisitionStatus, string>> = { IN_REVIEW: "requisitions.analyze", WAITING_MATERIAL: "requisitions.analyze", RELEASED: "requisitions.release", IN_CUTTING: "requisitions.cut", INSPECTION: "requisitions.cut", COMPLETED: "requisitions.inspect", CANCELLED: "requisitions.cancel" };

export function assertRequisitionTransition(current: RequisitionStatus, next: RequisitionStatus, permissions: string[]) {
  if (!TRANSITIONS[current].includes(next)) throw new BadRequestError(`Transição inválida: ${STATUS_LABEL[current]} → ${STATUS_LABEL[next]}`);
  const required = REQUIRED_PERMISSION[next];
  if (current === RequisitionStatus.DRAFT && next === RequisitionStatus.REQUESTED) return;
  if (required && !permissions.includes(required)) throw new ForbiddenError(`Permissão necessária: ${required}`);
}

async function cancelReservations(tx: Prisma.TransactionClient, requisitionId: string, actorId: string) {
  const reservations = await tx.stockReservation.findMany({ where: { requisitionId, status: ReservationStatus.ACTIVE } });
  for (const reservation of reservations) {
    await tx.product.update({ where: { id: reservation.productId }, data: { reservedStock: { decrement: reservation.quantity } } });
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: ReservationStatus.CANCELLED } });
    await tx.stockMovement.create({ data: { type: MovementType.RELEASE, productId: reservation.productId, quantity: reservation.quantity, responsibleId: actorId, reservationId: reservation.id, requisitionId, note: "Reserva liberada pelo cancelamento da requisição" } });
  }
}

export async function updateRequisitionStatus(id: string, next: RequisitionStatus, note: string | null, actorId: string, permissions: string[], responsibleId?: string | null) {
  const current = await requireRequisition(id);
  if (current.status === RequisitionStatus.DRAFT && next === RequisitionStatus.REQUESTED && current.requesterId !== actorId && !permissions.includes("requisitions.edit.all")) throw new ForbiddenError("Você só pode enviar seus próprios rascunhos");
  if (next === RequisitionStatus.CANCELLED && !permissions.includes("requisitions.read.all") && (current.requesterId !== actorId || !(current.status === RequisitionStatus.DRAFT || current.status === RequisitionStatus.REQUESTED))) throw new ForbiddenError("Solicitantes só podem cancelar suas próprias requisições antes da análise");
  assertRequisitionTransition(current.status, next, permissions);
  if (next === RequisitionStatus.RELEASED) {
    const insufficient = current.items.find((item) => item.product && (item.product.stock - item.product.reservedStock) + item.reservations.reduce((sum, reservation) => sum + reservation.quantity, 0) < item.quantity);
    if (insufficient) throw new BadRequestError(`Material insuficiente para liberar a peça "${insufficient.description}"`);
  }
  if (next === RequisitionStatus.INSPECTION && current.items.some((item) => item.status !== RequisitionItemStatus.CUT && item.status !== RequisitionItemStatus.INSPECTED)) throw new BadRequestError("Todas as peças precisam estar cortadas antes da conferência");
  const updated = await prisma.$transaction(async (tx) => {
    if (next === RequisitionStatus.CANCELLED) await cancelReservations(tx, id, actorId);
    const data: Prisma.RequisitionUpdateInput = { status: next, ...(responsibleId !== undefined ? { responsible: responsibleId ? { connect: { id: responsibleId } } : { disconnect: true } } : {}) };
    if (next === RequisitionStatus.REQUESTED) data.submittedAt = new Date();
    if (next === RequisitionStatus.IN_REVIEW) data.approvedBy = { connect: { id: actorId } };
    if (next === RequisitionStatus.RELEASED) data.approvedAt = new Date();
    if (next === RequisitionStatus.IN_CUTTING) { data.cutter = { connect: { id: actorId } }; if (!current.cuttingStartedAt) data.cuttingStartedAt = new Date(); }
    if (next === RequisitionStatus.COMPLETED) data.completedAt = new Date();
    if (next === RequisitionStatus.CANCELLED) data.cancelledAt = new Date();
    const req = await tx.requisition.update({ where: { id }, data, include });
    await logHistory(tx, id, actorId, "REQUISITION_STATUS_CHANGED", { status: current.status }, { status: next }, note);
    return req;
  });
  return serialize(updated);
}

export async function updateItemStatus(requisitionId: string, itemId: string, status: RequisitionItemStatus, actorId: string, note?: string | null) {
  const req = await requireRequisition(requisitionId);
  if (!(req.status === RequisitionStatus.IN_CUTTING || req.status === RequisitionStatus.INSPECTION)) throw new BadRequestError("O andamento das peças só pode ser alterado durante corte ou conferência");
  const item = req.items.find((entry) => entry.id === itemId); if (!item) throw new NotFoundError("Peça não encontrada");
  const allowed: Record<RequisitionItemStatus, RequisitionItemStatus[]> = { PENDING: [RequisitionItemStatus.CUTTING], CUTTING: [RequisitionItemStatus.PENDING, RequisitionItemStatus.CUT], CUT: [RequisitionItemStatus.CUTTING, RequisitionItemStatus.INSPECTED], INSPECTED: [RequisitionItemStatus.CUT] };
  if (!allowed[item.status].includes(status)) throw new BadRequestError("Transição inválida para a peça");
  await prisma.$transaction(async (tx) => { await tx.requisitionItem.update({ where: { id: itemId }, data: { status } }); await logHistory(tx, requisitionId, actorId, "REQUISITION_ITEM_STATUS_CHANGED", { itemId, status: item.status }, { itemId, status }, note); });
  return getRequisition(requisitionId);
}

export async function inspectRequisition(id: string, result: InspectionResult, note: string | null, actorId: string) {
  const current = await requireRequisition(id); if (current.status !== RequisitionStatus.INSPECTION) throw new BadRequestError("A requisição não está em conferência");
  const nextStatus = result === InspectionResult.APPROVED ? RequisitionStatus.COMPLETED : RequisitionStatus.IN_CUTTING;
  const updated = await prisma.$transaction(async (tx) => {
    if (result === InspectionResult.APPROVED) await tx.requisitionItem.updateMany({ where: { requisitionId: id }, data: { status: RequisitionItemStatus.INSPECTED } });
    const req = await tx.requisition.update({ where: { id }, data: { status: nextStatus, inspectorId: actorId, inspectedAt: new Date(), inspectionResult: result, inspectionNote: note, completedAt: result === InspectionResult.APPROVED ? new Date() : null }, include });
    await logHistory(tx, id, actorId, "REQUISITION_INSPECTED", { status: current.status }, { status: nextStatus, result }, note); return req;
  }); return serialize(updated);
}

export async function reserveMaterials(id: string, input: ReservationInput, actorId: string) {
  const req = await requireRequisition(id); if (!(req.status === RequisitionStatus.IN_REVIEW || req.status === RequisitionStatus.WAITING_MATERIAL)) throw new BadRequestError("Materiais só podem ser reservados durante a análise");
  await prisma.$transaction(async (tx) => {
    for (const requested of input.items) {
      const item = req.items.find((entry) => entry.id === requested.requisitionItemId); if (!item?.productId || !item.product) throw new BadRequestError("A peça precisa estar vinculada a um produto do estoque");
      const alreadyReserved = item.reservations.reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (alreadyReserved + requested.quantity > item.quantity) throw new BadRequestError(`Reserva superior ao necessário para "${item.description}"`);
      const changed = await tx.$executeRaw`UPDATE "Product" SET "reservedStock" = "reservedStock" + ${requested.quantity}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId} AND ("stock" - "reservedStock") >= ${requested.quantity}`;
      if (!changed) throw new BadRequestError(`Estoque disponível insuficiente para "${item.product.name}"`);
      const reservation = await tx.stockReservation.create({ data: { productId: item.productId, quantity: requested.quantity, requesterId: actorId, requisitionId: id, requisitionItemId: item.id, warehouseId: null, note: `Reserva para ${req.number}` } });
      await tx.stockMovement.create({ data: { type: MovementType.RESERVE, productId: item.productId, quantity: requested.quantity, responsibleId: actorId, reservationId: reservation.id, requisitionId: id, note: `Reserva para ${req.number}` } });
    }
    await logHistory(tx, id, actorId, "REQUISITION_MATERIAL_RESERVED", undefined, { items: input.items });
  });
  return getRequisition(id);
}

export async function listCuttingBoard() {
  const rows = await prisma.requisition.findMany({ where: { status: { in: [RequisitionStatus.RELEASED, RequisitionStatus.IN_CUTTING, RequisitionStatus.INSPECTION, RequisitionStatus.COMPLETED] } }, include, orderBy: [{ priority: "desc" }, { neededAt: "asc" }, { createdAt: "asc" }], take: 200 });
  return rows.map(serialize);
}
