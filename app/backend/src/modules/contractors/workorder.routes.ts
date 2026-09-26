/**
 * Requisições de montagem (gestão) e a página pública do QR (montador).
 * Gestão: hr.read vê, hr.employees.manage cria/cancela — as mesmas regras dos
 * cômodos. Público: só o token; vale enquanto a requisição estiver aberta.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, InvalidStateError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { rateLimit } from "../../utils/rate-limit";
import { notifyUsersWithPermission } from "../../lib/notify";
import { finishTask, pauseTask, startTask } from "./installation.service";
import { ROOM_LABEL, classifyRoom } from "./productivity.service";
import { isTokenShape, newWorkOrderToken, nextWorkOrderNumber, serializeWorkOrder, workOrderInclude, workOrderPdf } from "./workorder.service";

// ------------------------------------------------------------------ gestão

export const workOrderRoutes = Router();
workOrderRoutes.use(authenticate);

async function findOrder(req: Request) {
  const o = await prisma.installationWorkOrder.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, include: workOrderInclude });
  if (!o) throw new NotFoundError("Requisição não encontrada");
  return o;
}

async function audit(userId: string, action: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity: "InstallationWorkOrder", entityId, details } });
}

// GET /api/work-orders?status=&contractorId=&projectId=
workOrderRoutes.get(
  "/",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const status = z.enum(["OPEN", "DONE", "CANCELLED"]).optional().parse(req.query.status || undefined);
    const rows = await prisma.installationWorkOrder.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(status ? { status } : {}),
        ...(req.query.contractorId ? { contractorId: String(req.query.contractorId) } : {}),
        ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}),
      },
      include: workOrderInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok(res, rows.map((o) => serializeWorkOrder(o, { withToken: false })));
  })
);

// GET /api/work-orders/pending-tasks?projectId=&contractorId= — cômodos do montador na obra ainda sem requisição
workOrderRoutes.get(
  "/pending-tasks",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const { projectId, contractorId } = z.object({ projectId: z.string().min(1), contractorId: z.string().min(1) }).parse(req.query);
    const rows = await prisma.installationTask.findMany({
      where: { organizationId: req.user!.organizationId, projectId, contractorId, workOrderId: null, status: { in: ["PENDING", "PAUSED", "IN_PROGRESS"] } },
      select: { id: true, roomType: true, roomLabel: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return ok(res, rows.map((t) => ({ ...t, name: t.roomLabel || ROOM_LABEL[t.roomType] })));
  })
);

// POST /api/work-orders { projectId, contractorId, taskIds?, rooms?, scheduledFor?, instructions? }
workOrderRoutes.post(
  "/",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        projectId: z.string().min(1),
        contractorId: z.string().min(1),
        taskIds: z.array(z.string().min(1)).max(50).default([]),
        rooms: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
        scheduledFor: z.coerce.date().optional().nullable(),
        instructions: z.string().trim().max(3000).optional().nullable(),
      })
      .parse(req.body);
    if (!input.taskIds.length && !input.rooms.length) throw new BadRequestError("Inclua pelo menos um cômodo");
    const orgId = req.user!.organizationId;
    const [contractor, project] = await Promise.all([
      prisma.contractor.findFirst({ where: { id: input.contractorId, organizationId: orgId }, select: { id: true, active: true, name: true } }),
      prisma.project.findFirst({ where: { id: input.projectId, organizationId: orgId }, select: { id: true, code: true } }),
    ]);
    if (!contractor) throw new BadRequestError("Montador inválido");
    if (!contractor.active) throw new BadRequestError("Montador inativo");
    if (!project) throw new BadRequestError("Obra inválida");
    const existing = input.taskIds.length
      ? await prisma.installationTask.findMany({
          where: { id: { in: input.taskIds }, organizationId: orgId, projectId: project.id, contractorId: contractor.id, workOrderId: null, status: { notIn: ["DONE", "CANCELLED"] } },
          select: { id: true },
        })
      : [];
    if (existing.length !== input.taskIds.length) throw new BadRequestError("Algum cômodo não é deste montador nesta obra, já está em outra requisição ou já foi concluído");

    const number = await nextWorkOrderNumber(orgId);
    const created = await prisma.$transaction(async (tx) => {
      const o = await tx.installationWorkOrder.create({
        data: {
          organizationId: orgId,
          number,
          projectId: project.id,
          contractorId: contractor.id,
          token: newWorkOrderToken(),
          scheduledFor: input.scheduledFor ?? null,
          instructions: input.instructions || null,
          createdById: req.user!.id,
        },
      });
      if (existing.length) await tx.installationTask.updateMany({ where: { id: { in: existing.map((t) => t.id) } }, data: { workOrderId: o.id } });
      for (const room of input.rooms) {
        await tx.installationTask.create({
          data: { organizationId: orgId, projectId: project.id, contractorId: contractor.id, roomType: classifyRoom(room), roomLabel: room, workOrderId: o.id, createdById: req.user!.id },
        });
      }
      return tx.installationWorkOrder.findUniqueOrThrow({ where: { id: o.id }, include: workOrderInclude });
    });
    await audit(req.user!.id, "WORK_ORDER_CREATED", created.id, { number, project: project.code, contractor: contractor.name, tasks: created.tasks.length });
    return ok(res, serializeWorkOrder(created, { withToken: true }), `Requisição ${number} criada`);
  })
);

workOrderRoutes.get(
  "/:id",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => ok(res, serializeWorkOrder(await findOrder(req), { withToken: true })))
);

// GET /api/work-orders/:id/pdf — a folha com o QR (gerada na hora, não fica guardada)
workOrderRoutes.get(
  "/:id/pdf",
  requirePermission("hr.read"),
  asyncHandler(async (req, res) => {
    const o = await findOrder(req);
    if (o.status !== "OPEN") throw new InvalidStateError("Requisição encerrada: o QR já não vale");
    const pdf = await workOrderPdf(o);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="requisicao-${o.number.toLowerCase()}.pdf"`);
    res.send(pdf);
  })
);

// POST /api/work-orders/:id/cancel — o QR deixa de valer; os cômodos voltam a ficar sem requisição
workOrderRoutes.post(
  "/:id/cancel",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const o = await findOrder(req);
    if (o.status !== "OPEN") throw new InvalidStateError("Requisição já encerrada");
    await prisma.$transaction([
      prisma.installationTask.updateMany({ where: { workOrderId: o.id, status: { not: "DONE" } }, data: { workOrderId: null } }),
      prisma.installationWorkOrder.update({ where: { id: o.id }, data: { status: "CANCELLED" } }),
    ]);
    await audit(req.user!.id, "WORK_ORDER_CANCELLED", o.id);
    return ok(res, { cancelled: true }, `Requisição ${o.number} cancelada — o QR não vale mais`);
  })
);

// POST /api/work-orders/:id/new-link — folha perdida: troca o token e invalida a impressa
workOrderRoutes.post(
  "/:id/new-link",
  requirePermission("hr.employees.manage"),
  asyncHandler(async (req, res) => {
    const o = await findOrder(req);
    if (o.status !== "OPEN") throw new InvalidStateError("Requisição já encerrada");
    const updated = await prisma.installationWorkOrder.update({ where: { id: o.id }, data: { token: newWorkOrderToken() }, include: workOrderInclude });
    await audit(req.user!.id, "WORK_ORDER_LINK_RENEWED", o.id);
    return ok(res, serializeWorkOrder(updated, { withToken: true }), "Novo QR gerado — imprima a folha de novo; a anterior não vale mais");
  })
);

// ------------------------------------------------------------------ público (QR)

export const publicWorkOrderRoutes = Router();
// Sem login: segura quem tentar adivinhar token ou martelar os botões.
publicWorkOrderRoutes.use(rateLimit({ name: "public-work-order", windowMs: 60_000, max: 60 }));

async function byToken(token: string) {
  if (!isTokenShape(token)) throw new NotFoundError("Link inválido ou expirado");
  const o = await prisma.installationWorkOrder.findUnique({ where: { token }, include: workOrderInclude });
  // Concluída continua abrindo (só leitura) por 7 dias, para o montador ver que fechou.
  const expired = !o || o.status === "CANCELLED" || (o.status === "DONE" && o.completedAt && o.completedAt.getTime() < Date.now() - 7 * 86400000);
  if (expired) throw new NotFoundError("Link inválido ou expirado");
  return o!;
}

/** Na página pública vai só o que o montador precisa na obra. */
function publicView(o: Awaited<ReturnType<typeof byToken>>) {
  const s = serializeWorkOrder(o, { withToken: false });
  return {
    number: s.number,
    status: s.status,
    scheduledFor: s.scheduledFor,
    instructions: s.instructions,
    project: s.project,
    client: s.client,
    contractor: { name: s.contractor.name },
    tasks: s.tasks.filter((t) => t.status !== "CANCELLED").map((t) => ({ id: t.id, name: t.name, status: t.status, startedAt: t.startedAt, finishedAt: t.finishedAt, workedMinutes: t.workedMinutes })),
    progress: s.progress,
    receivedByName: s.receivedByName,
    completedAt: s.completedAt,
  };
}

// GET /api/public/os/:token
publicWorkOrderRoutes.get(
  "/:token",
  asyncHandler(async (req, res) => ok(res, publicView(await byToken(req.params.token))))
);

// POST /api/public/os/:token/tasks/:taskId/(start|pause|finish) { notes? }
publicWorkOrderRoutes.post(
  "/:token/tasks/:taskId/:action(start|pause|finish)",
  asyncHandler(async (req, res) => {
    const o = await byToken(req.params.token);
    if (o.status !== "OPEN") throw new InvalidStateError("Requisição já concluída");
    const scope = { workOrderId: o.id };
    const action = req.params.action as "start" | "pause" | "finish";
    const notes = z.object({ notes: z.string().trim().max(2000).optional().nullable() }).parse(req.body ?? {}).notes;
    if (action === "start") await startTask(req.params.taskId, scope);
    else if (action === "pause") await pauseTask(req.params.taskId, scope);
    else await finishTask(req.params.taskId, scope, notes || undefined);
    const msg = { start: "Cômodo iniciado", pause: "Cômodo pausado", finish: "Cômodo concluído" }[action];
    return ok(res, publicView(await byToken(req.params.token)), msg);
  })
);

// POST /api/public/os/:token/complete { receivedByName, signature } — conferência do cliente
publicWorkOrderRoutes.post(
  "/:token/complete",
  asyncHandler(async (req, res) => {
    const o = await byToken(req.params.token);
    if (o.status !== "OPEN") throw new InvalidStateError("Requisição já concluída");
    const input = z
      .object({
        receivedByName: z.string().trim().min(2, "Nome de quem recebeu").max(120),
        signature: z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Assinatura inválida"),
      })
      .parse(req.body);
    const pending = o.tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
    if (pending.length) throw new InvalidStateError(`Conclua todos os cômodos antes (${pending.length} em aberto)`);
    await prisma.installationWorkOrder.update({
      where: { id: o.id },
      data: { status: "DONE", completedAt: new Date(), receivedByName: input.receivedByName, clientSignature: input.signature },
    });
    await prisma.auditLog.create({
      data: { userId: null, action: "WORK_ORDER_COMPLETED", entity: "InstallationWorkOrder", entityId: o.id, details: { number: o.number, receivedByName: input.receivedByName, via: "qr" } },
    });
    await notifyUsersWithPermission({
      organizationId: o.organizationId,
      permission: "hr.employees.manage",
      title: `Requisição ${o.number} concluída`,
      message: `${o.contractor.name} concluiu a montagem em ${o.project.code}. Recebido por ${input.receivedByName}.`,
    });
    return ok(res, publicView(await byToken(req.params.token)), "Montagem concluída. Obrigado!");
  })
);
