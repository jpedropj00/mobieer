import { NotificationType, RequisitionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { nextCode } from "../../utils/helpers";
import type { CreateRequisitionInput } from "./requisitions.schema";
import { createExit } from "../stock/stock.service";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  IN_REVIEW: "Em análise",
  APPROVED: "Aprovada",
  SEPARATION: "Separação",
  CONCLUDED: "Concluída",
  REFUSED: "Recusada",
  CANCELLED: "Cancelada",
};

function serialize(requisition: {
  id: string;
  number: string;
  sector: string | null;
  destination: string | null;
  status: string;
  note: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  requester: { id: string; name: string; sector: string | null; position: string | null };
  approvedBy: { id: string; name: string } | null;
  items: {
    id: string;
    quantity: number;
    status: string;
    product: { id: string; name: string; code: string; unit: string; stock: number };
  }[];
}) {
  const totalQty = requisition.items.reduce((acc, i) => acc + i.quantity, 0);
  return {
    id: requisition.id,
    number: requisition.number,
    sector: requisition.sector,
    destination: requisition.destination,
    status: requisition.status,
    statusLabel: STATUS_LABEL[requisition.status] ?? requisition.status,
    note: requisition.note,
    approvedAt: requisition.approvedAt,
    createdAt: requisition.createdAt,
    updatedAt: requisition.updatedAt,
    requester: requisition.requester,
    approvedBy: requisition.approvedBy,
    itemCount: requisition.items.length,
    totalQty,
    items: requisition.items,
  };
}

const include = {
  requester: { select: { id: true, name: true, sector: true, position: true } },
  approvedBy: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, code: true, unit: true, stock: true } },
    },
  },
};

export async function listRequisitions(params: {
  page: number;
  perPage: number;
  status?: string;
  search?: string;
  userId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.userId) where.requesterId = params.userId;
  if (params.search) {
    where.OR = [
      { number: { contains: params.search, mode: "insensitive" } },
      { requester: { name: { contains: params.search, mode: "insensitive" } } },
      { sector: { contains: params.search, mode: "insensitive" } },
      { items: { some: { product: { name: { contains: params.search, mode: "insensitive" } } } } },
    ];
  }

  const total = await prisma.requisition.count({ where });
  const pages = Math.max(1, Math.ceil(total / params.perPage));
  const requisitions = await prisma.requisition.findMany({
    where,
    include,
    orderBy: { createdAt: "desc" },
    skip: (params.page - 1) * params.perPage,
    take: params.perPage,
  });

  return {
    items: requisitions.map(serialize),
    meta: { page: params.page, perPage: params.perPage, total, pages },
  };
}

export async function getRequisition(id: string) {
  const requisition = await prisma.requisition.findUnique({ where: { id }, include });
  if (!requisition) throw new NotFoundError("Requisição não encontrada");
  return serialize(requisition);
}

export async function createRequisition(input: CreateRequisitionInput, requesterId: string, requesterName: string) {
  const number = await nextCode("requisition", "REQ");

  const requisition = await prisma.$transaction(async (tx) => {
    const req = await tx.requisition.create({
      data: {
        number,
        sector: input.sector ?? null,
        destination: input.destination ?? null,
        note: input.note ?? null,
        requesterId,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include,
    });

    await tx.auditLog.create({
      data: {
        userId: requesterId,
        action: "REQUISITION_CREATED",
        entity: "Requisition",
        entityId: req.id,
        details: { number, items: input.items.length },
      },
    });

    await tx.notification.create({
      data: {
        type: NotificationType.NEW_REQUISITION,
        title: "Nova requisição",
        message: `${requesterName} criou a requisição ${number}`,
      },
    });

    return req;
  });

  return serialize(requisition);
}

const TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  PENDING: [RequisitionStatus.IN_REVIEW, RequisitionStatus.CANCELLED],
  IN_REVIEW: [RequisitionStatus.APPROVED, RequisitionStatus.REFUSED, RequisitionStatus.CANCELLED],
  APPROVED: [RequisitionStatus.SEPARATION, RequisitionStatus.CANCELLED],
  SEPARATION: [RequisitionStatus.CONCLUDED, RequisitionStatus.CANCELLED],
  CONCLUDED: [],
  REFUSED: [],
  CANCELLED: [],
};

export async function updateRequisitionStatus(
  id: string,
  nextStatus: RequisitionStatus,
  note: string | null,
  actorId: string,
  actorName: string,
  allowNegative = false
) {
  const requisition = await prisma.requisition.findUnique({
    where: { id },
    include: {
      requester: { select: { id: true, name: true } },
      items: { include: { product: true } },
    },
  });
  if (!requisition) throw new NotFoundError("Requisição não encontrada");

  if (requisition.status === nextStatus) {
    throw new BadRequestError("A requisição já está neste status");
  }

  const allowed = TRANSITIONS[requisition.status];
  if (!allowed.includes(nextStatus)) {
    throw new BadRequestError(
      `Transição inválida: ${requisition.status} → ${nextStatus}. Permitidas: ${allowed.join(", ") || "nenhuma"}`
    );
  }

  const data: Record<string, unknown> = { status: nextStatus, note: note ?? requisition.note };
  if (nextStatus === RequisitionStatus.APPROVED) {
    data.approvedById = actorId;
    data.approvedAt = new Date();
  }

  const updated = await prisma.$transaction(async (tx) => {
    const req = await tx.requisition.update({ where: { id }, data, include });

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "REQUISITION_STATUS_CHANGED",
        entity: "Requisition",
        entityId: id,
        details: { number: req.number, from: requisition.status, to: nextStatus, note },
      },
    });

    if (nextStatus === RequisitionStatus.APPROVED) {
      await tx.notification.create({
        data: {
          type: NotificationType.REQUISITION_APPROVED,
          title: "Requisição aprovada",
          message: `A requisição ${req.number} foi aprovada por ${actorName}`,
          userId: requisition.requesterId,
        },
      });
    }

    if (nextStatus === RequisitionStatus.REFUSED) {
      await tx.notification.create({
        data: {
          type: NotificationType.REQUISITION_REFUSED,
          title: "Requisição recusada",
          message: `A requisição ${req.number} foi recusada${note ? `: ${note}` : ""}`,
          userId: requisition.requesterId,
        },
      });
    }

    if (nextStatus === RequisitionStatus.CONCLUDED) {
      // Deduct stock for each item
      const items = requisition.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }));
      await createExit(
        {
          items,
          requesterName: requisition.requester.name,
          sector: requisition.sector ?? undefined,
          destination: requisition.destination ?? undefined,
          reason: `Requisição ${req.number}`,
          requisitionId: id,
        },
        actorId,
        actorName,
        allowNegative
      );
    }

    return req;
  });

  return serialize(updated);
}
