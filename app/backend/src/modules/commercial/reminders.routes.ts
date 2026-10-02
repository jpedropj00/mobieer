/**
 * Lembretes do comercial: /api/commercial/reminders
 *
 * Quem não tem commercial.read.all (o CONSULTOR) vê só a própria carteira.
 */
import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import { buildReminders, REMINDER_LABEL, type ReminderKind } from "./reminders.rules";
import { loadReminderData } from "./reminders.service";

const router = Router();
router.use(authenticate);

// GET /api/commercial/reminders?sellerId=
router.get(
  "/",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const seeAll = req.user!.permissions.includes("commercial.read.all");
    const sellerId = seeAll ? (req.query.sellerId ? String(req.query.sellerId) : null) : req.user!.id;
    const items = buildReminders(await loadReminderData({ organizationId: req.user!.organizationId, sellerId }));

    const counts = (Object.keys(REMINDER_LABEL) as ReminderKind[])
      .map((kind) => ({ kind, label: REMINDER_LABEL[kind], count: items.filter((i) => i.kind === kind).length }))
      .filter((c) => c.count > 0);
    const sellers = new Map<string, { id: string; name: string; count: number }>();
    for (const i of items) {
      if (!i.sellerId) continue;
      const cur = sellers.get(i.sellerId) ?? { id: i.sellerId, name: i.sellerName ?? "", count: 0 };
      cur.count++;
      sellers.set(i.sellerId, cur);
    }
    return ok(res, { total: items.length, scope: sellerId ? "seller" : "store", counts, sellers: [...sellers.values()].sort((a, b) => b.count - a.count), items });
  })
);

export default router;
