import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { SupplierStatus } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";
import { NotFoundError } from "../../utils/ApiError";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  cnpj: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  status: z.nativeEnum(SupplierStatus).default(SupplierStatus.ACTIVE),
});

async function serialize(s: {
  id: string;
  name: string;
  cnpj: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  createdAt: Date;
  _count?: { products: number };
}) {
  return {
    id: s.id,
    name: s.name,
    cnpj: s.cnpj,
    contact: s.contact,
    phone: s.phone,
    email: s.email,
    address: s.address,
    status: s.status,
    productCount: s._count?.products ?? 0,
    createdAt: s.createdAt,
  };
}

const list = asyncHandler(async (req: Request, res: Response) => {
  const search = req.query.search as string | undefined;
  const suppliers = await prisma.supplier.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { cnpj: { contains: search } },
            { contact: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
  return ok(res, await Promise.all(suppliers.map(serialize)));
});

const create = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.parse(req.body);
  const supplier = await prisma.supplier.create({ data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "SUPPLIER_CREATED", entity: "Supplier", entityId: supplier.id, details: { name: supplier.name } },
  });
  return ok(res, await serialize(supplier), "Fornecedor cadastrado");
});

const update = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.partial().parse(req.body);
  const exists = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Fornecedor não encontrado");
  const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "SUPPLIER_UPDATED", entity: "Supplier", entityId: supplier.id, details: { name: supplier.name } },
  });
  return ok(res, await serialize(supplier), "Fornecedor atualizado");
});

const remove = asyncHandler(async (req: Request, res: Response) => {
  const exists = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Fornecedor não encontrado");
  await prisma.supplier.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "SUPPLIER_DELETED", entity: "Supplier", entityId: req.params.id },
  });
  return ok(res, { deleted: true }, "Fornecedor removido");
});

const router = Router();
router.use(authenticate);
router.get("/", requirePermission("suppliers.read"), list);
router.post("/", requirePermission("suppliers.create"), create);
router.put("/:id", requirePermission("suppliers.update"), update);
router.delete("/:id", requirePermission("suppliers.delete"), remove);

export default router;
