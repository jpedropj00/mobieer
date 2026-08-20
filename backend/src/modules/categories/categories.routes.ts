import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";

const schema = z.object({
  name: z.string().min(2, "Nome obrigatório"),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

async function serialize(cat: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  _count?: { products: number };
  parent?: { id: string; name: string } | null;
}) {
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    productCount: cat._count?.products ?? 0,
    createdAt: cat.createdAt,
    parent: cat.parent ?? null,
  };
}

const list = asyncHandler(async (req: Request, res: Response) => {
  const categories = await prisma.category.findMany({
    include: { parent: { select: { id: true, name: true } }, _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
  return ok(res, await Promise.all(categories.map(serialize)));
});

const create = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.parse(req.body);
  const category = await prisma.category.create({ data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "CATEGORY_CREATED", entity: "Category", entityId: category.id, details: { name: category.name } },
  });
  return ok(res, await serialize(category), "Categoria criada");
});

const update = asyncHandler(async (req: Request, res: Response) => {
  const input = schema.partial().parse(req.body);
  if (input.parentId === req.params.id) throw new BadRequestError("Uma categoria não pode ser subordinada a ela mesma");
  const exists = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Categoria não encontrada");
  if (input.parentId) {
    let ancestorId: string | null = input.parentId;
    while (ancestorId) {
      if (ancestorId === req.params.id) throw new BadRequestError("A hierarquia de categorias não pode ser circular");
      const ancestor: { parentId: string | null } | null = await prisma.category.findUnique({ where: { id: ancestorId }, select: { parentId: true } });
      if (!ancestor) throw new BadRequestError("Categoria superior não encontrada");
      ancestorId = ancestor.parentId;
    }
  }
  const category = await prisma.category.update({ where: { id: req.params.id }, data: input });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "CATEGORY_UPDATED", entity: "Category", entityId: category.id, details: { name: category.name } },
  });
  return ok(res, await serialize(category), "Categoria atualizada");
});

const remove = asyncHandler(async (req: Request, res: Response) => {
  const exists = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!exists) throw new NotFoundError("Categoria não encontrada");
  await prisma.category.delete({ where: { id: req.params.id } });
  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: "CATEGORY_DELETED", entity: "Category", entityId: req.params.id },
  });
  return ok(res, { deleted: true }, "Categoria removida");
});

const router = Router();
router.use(authenticate);
router.get("/", requirePermission("categories.read"), list);
router.post("/", requirePermission("categories.create"), create);
router.put("/:id", requirePermission("categories.update"), update);
router.delete("/:id", requirePermission("categories.delete"), remove);

export default router;
