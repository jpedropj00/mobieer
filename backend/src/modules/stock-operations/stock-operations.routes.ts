import { Router } from "express";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { ok } from "../../utils/response";
import * as service from "./stock-operations.service";
import { occurrenceSchema, reservationActionSchema, reservationSchema, transferSchema, usageQuery } from "./stock-operations.schema";

const router = Router();
router.use(authenticate);

router.post("/transfers", requirePermission("stock.transfer"), asyncHandler(async (req, res) => ok(res, await service.transferStock(transferSchema.parse(req.body), req.user!.id), "Transferência registrada")));
router.get("/reservations", requirePermission("stock.reserve"), asyncHandler(async (req, res) => ok(res, await service.listReservations(req.query.status as string | undefined))));
router.post("/reservations", requirePermission("stock.reserve"), asyncHandler(async (req, res) => ok(res, await service.createReservation(reservationSchema.parse(req.body), req.user!.id), "Reserva criada")));
router.patch("/reservations/:id", requirePermission("stock.reserve"), asyncHandler(async (req, res) => {
  const input = reservationActionSchema.parse(req.body);
  return ok(res, await service.resolveReservation(req.params.id, input.action, req.user!.id, input.note), "Reserva atualizada");
}));
router.post("/occurrences", requirePermission("stock.occurrence"), asyncHandler(async (req, res) => ok(res, await service.registerOccurrence(occurrenceSchema.parse(req.body), req.user!.id), "Ocorrência registrada")));
router.get("/usage", requirePermission("stock.read"), asyncHandler(async (req, res) => {
  const q = usageQuery.parse(req.query);
  return ok(res, await service.usageAnalytics(q.days, q.limit));
}));

export default router;
