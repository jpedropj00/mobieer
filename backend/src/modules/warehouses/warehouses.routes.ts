import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  code: z.string().min(1, "Código obrigatório"),
  address: z.string().optional().nullable(),
});

async function serialize(w: {
  id: string;
  name: string;
  code: string;
  address: string | null;
  createdAt: Date;
  _count?: { products: number };
}) {
  return {
    id: w.id,
    name: w.name,
    code: w.code,
    address: w.address,
    productCount: w._count?.products ?? 0,
    createdAt: w.createdAt,
  };
}

const list = asyncHandler(async (_req: Request, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
  return ok(res, await Promise.all(warehouses.map(serialize)));
});

const create = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.parse(req.body);
  const warehouse = await prisma.warehouse.create({ data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "WAREHOUSE_CREATED", entity: "Warehouse", entityId: warehouse.id, details: { name: warehouse.name } },
  });
  return ok(res, await serialize(warehouse), "Almoxarifado criado");
});

const update = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.partial().parse(req.body);
  const exists = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Almoxarifado não encontrado");
  const warehouse = await prisma.warehouse.update({ where: { id: req.params.id }, data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "WAREHOUSE_UPDATED", entity: "Warehouse", entityId: warehouse.id, details: { name: warehouse.name } },
  });
  return ok(res, await serialize(warehouse), "Almoxarifado atualizado");
});

const remove = asyncHandler(async (req: Request, res: Response) => {
  const exists = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Almoxarifado não encontrado");
  await prisma.warehouse.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "WAREHOUSE_DELETED", entity: "Warehouse", entityId: req.params.id },
  });
  return ok(res, { deleted: true }, "Almoxarifado removido");
});

const router = Router();
router.use(authenticate);
router.get("/", requirePermission("warehouses.read"), list);
router.post("/", requirePermission("warehouses.manage"), create);
router.put("/:id", requirePermission("warehouses.manage"), update);
router.delete("/:id", requirePermission("warehouses.manage"), remove);

export default router;
