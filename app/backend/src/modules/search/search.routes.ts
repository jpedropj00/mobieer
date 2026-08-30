import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(15, Number(req.query.limit) || 8);

    if (!q) return ok(res, { products: [], movements: [], requisitions: [], users: [], suppliers: [] });

    const [products, movements, requisitions, users, suppliers] = await Promise.all([
      prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { category: { select: { id: true, name: true } } },
        orderBy: { name: "asc" },
        take: limit,
      }),
      prisma.stockMovement.findMany({
        where: {
          OR: [
            { product: { name: { contains: q, mode: "insensitive" } } },
            { product: { code: { contains: q, mode: "insensitive" } } },
            { invoiceNumber: { contains: q } },
          ],
        },
        include: { product: { select: { id: true, name: true, code: true } } },
        orderBy: { date: "desc" },
        take: limit,
      }),
      prisma.requisition.findMany({
        where: {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { requester: { name: { contains: q, mode: "insensitive" } } },
          ],
        },
        include: { requester: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, email: true, position: true, sector: true },
        orderBy: { name: "asc" },
        take: limit,
      }),
      prisma.supplier.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { cnpj: { contains: q } },
            { contact: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, cnpj: true, contact: true },
        orderBy: { name: "asc" },
        take: limit,
      }),
    ]);

    return ok(res, { products, movements, requisitions, users, suppliers });
  })
);

export default router;
