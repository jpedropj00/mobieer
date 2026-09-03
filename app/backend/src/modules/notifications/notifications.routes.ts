import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { prisma } from "../../prisma";
import { BadRequestError } from "../../utils/ApiError";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const unread = req.query.unread === "true";
    const notifications = await prisma.notification.findMany({
      where: unread ? { read: false } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { product: { select: { id: true, name: true, code: true } } },
    });
    const unreadCount = await prisma.notification.count({ where: { read: false } });
    return ok(res, { items: notifications, unreadCount });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notification) throw new BadRequestError("Notificação não encontrada");
    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    return ok(res, updated);
  })
);

router.patch(
  "/read-all",
  asyncHandler(async (_req, res) => {
    await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    return ok(res, { updated: true });
  })
);

export default router;
