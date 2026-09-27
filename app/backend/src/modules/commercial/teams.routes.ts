/**
 * Equipes comerciais, transferência de carteira (clientes de um vendedor para
 * outro) e campos obrigatórios do cadastro de cliente.
 */
import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { notifyUser } from "../../lib/notify";
import { CLIENT_FIELD_LABEL, loadRequiredClientFields, REQUIRED_FIELDS_SETTING } from "./client-fields";

const router = Router();
router.use(authenticate);

// ------------------------------------------------------------------ equipes

router.get(
  "/teams",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.salesTeam.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { leader: { select: { id: true, name: true } }, members: { select: { id: true, name: true, role: { select: { label: true } } }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    });
    return ok(res, rows);
  })
);

const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  leaderId: z.string().optional().nullable(),
  memberIds: z.array(z.string()).max(200).default([]),
  active: z.boolean().optional(),
});

async function saveTeam(orgId: string, id: string | null, input: z.infer<typeof teamSchema>) {
  const ids = [...new Set([...input.memberIds, ...(input.leaderId ? [input.leaderId] : [])])];
  if (ids.length && (await prisma.user.count({ where: { id: { in: ids }, organizationId: orgId } })) !== ids.length) throw new BadRequestError("Pessoa inválida na equipe");
  return prisma.$transaction(async (tx) => {
    const team = id
      ? await tx.salesTeam.update({ where: { id }, data: { name: input.name, leaderId: input.leaderId || null, active: input.active ?? true } })
      : await tx.salesTeam.create({ data: { organizationId: orgId, name: input.name, leaderId: input.leaderId || null } });
    // quem saiu da lista deixa a equipe; quem entrou sai da equipe anterior (uma equipe por pessoa)
    await tx.user.updateMany({ where: { salesTeamId: team.id, id: { notIn: input.memberIds } }, data: { salesTeamId: null } });
    if (input.memberIds.length) await tx.user.updateMany({ where: { id: { in: input.memberIds } }, data: { salesTeamId: team.id } });
    return team;
  });
}

router.post(
  "/teams",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = teamSchema.parse(req.body);
    if (await prisma.salesTeam.findFirst({ where: { organizationId: req.user!.organizationId, name: input.name } })) throw new BadRequestError("Já existe uma equipe com esse nome");
    const t = await saveTeam(req.user!.organizationId, null, input);
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "SALES_TEAM_CREATED", entity: "SalesTeam", entityId: t.id, details: { name: t.name } } });
    return ok(res, t, "Equipe criada");
  })
);

router.put(
  "/teams/:id",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const cur = await prisma.salesTeam.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!cur) throw new NotFoundError("Equipe não encontrada");
    const t = await saveTeam(req.user!.organizationId, cur.id, teamSchema.parse(req.body));
    return ok(res, t, "Equipe atualizada");
  })
);

// ------------------------------------------------------------------ transferir carteira

// POST /api/commercial/portfolio/transfer { clientIds, toSellerId, moveOpenOpportunities, moveOpenQuotes }
router.post(
  "/portfolio/transfer",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        clientIds: z.array(z.string().min(1)).min(1, "Escolha os clientes").max(500),
        toSellerId: z.string().min(1),
        moveOpenOpportunities: z.boolean().default(true),
        moveOpenQuotes: z.boolean().default(true),
      })
      .parse(req.body);
    const orgId = req.user!.organizationId;
    const to = await prisma.user.findFirst({ where: { id: input.toSellerId, organizationId: orgId, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!to) throw new BadRequestError("Vendedor de destino inválido");
    const clients = await prisma.client.findMany({ where: { id: { in: input.clientIds }, organizationId: orgId }, select: { id: true, name: true, sellerId: true } });
    if (clients.length !== input.clientIds.length) throw new BadRequestError("Algum cliente não é desta loja");
    const ids = clients.map((c) => c.id);
    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.client.updateMany({ where: { id: { in: ids } }, data: { sellerId: to.id } });
      const o = input.moveOpenOpportunities
        ? await tx.commercialOpportunity.updateMany({ where: { clientId: { in: ids }, status: "OPEN" }, data: { sellerId: to.id } })
        : { count: 0 };
      const q = input.moveOpenQuotes
        ? await tx.commercialQuote.updateMany({ where: { clientId: { in: ids }, status: { in: ["DRAFT", "SENT", "VIEWED", "NEGOTIATION"] } }, data: { sellerId: to.id } })
        : { count: 0 };
      return { clients: c.count, opportunities: o.count, quotes: q.count };
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "PORTFOLIO_TRANSFERRED", entity: "User", entityId: to.id, details: { ...result, clients: clients.map((c) => ({ id: c.id, from: c.sellerId })) } },
    });
    if (to.id !== req.user!.id) {
      await notifyUser(to.id, "Clientes transferidos para você", `${req.user!.name} passou ${result.clients} cliente(s) para a sua carteira${result.opportunities ? `, com ${result.opportunities} oportunidade(s) em aberto` : ""}.`);
    }
    return ok(res, result, `${result.clients} cliente(s) transferido(s) para ${to.name}${result.opportunities ? ` · ${result.opportunities} oportunidade(s)` : ""}${result.quotes ? ` · ${result.quotes} orçamento(s)` : ""}`);
  })
);

// ------------------------------------------------------------------ campos obrigatórios

router.get(
  "/client-fields",
  requirePermission("commercial.read"),
  asyncHandler(async (_req, res) => ok(res, { required: await loadRequiredClientFields(), available: CLIENT_FIELD_LABEL }))
);

router.put(
  "/client-fields",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const keys = Object.keys(CLIENT_FIELD_LABEL) as [string, ...string[]];
    const { required } = z.object({ required: z.array(z.enum(keys)).max(keys.length) }).parse(req.body);
    const value = JSON.stringify([...new Set(required)]);
    await prisma.setting.upsert({ where: { key: REQUIRED_FIELDS_SETTING }, create: { key: REQUIRED_FIELDS_SETTING, value }, update: { value } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "CLIENT_REQUIRED_FIELDS_UPDATED", entity: "Setting", entityId: REQUIRED_FIELDS_SETTING, details: { required } } });
    return ok(res, { required }, "Campos obrigatórios salvos");
  })
);

export default router;
