import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { prisma } from "../../prisma";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;
    const entity = req.query.entity as string | undefined;

    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;

    const total = await prisma.auditLog.count({ where });
    const pages = Math.max(1, Math.ceil(total / perPage));
    const logs = await prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const actions = await prisma.auditLog.groupBy({ by: ["action"], _count: true });
    return res.json({
      success: true,
      data: logs,
      meta: { page, perPage, total, pages },
      actions: actions.map((a) => ({ action: a.action, count: a._count })),
    });
  })
);

export default router;
