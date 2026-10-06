/**
 * Orçamentos do comercial: preço a partir do custo, comissões, financeira,
 * pontuação com liberação abaixo do mínimo e PDF com a assinatura de quem
 * vendeu. Quem não tem commercial.read.all vê só os próprios orçamentos.
 */
import crypto from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, QuoteStatus } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { notifyUser, notifyUsersWithPermission } from "../../lib/notify";
import { storeGeneratedPdf } from "../docgen/docgen.service";
import { brl } from "../templates/contract.service";
import { PAYMENT_METHODS, QuoteRuleError, computeQuote, normalizePricing, type PricingConfig } from "./quote.rules";
import { CATEGORY_SALE, planFinance } from "./quote.finance";
import { hasBudgetValues, roomsFromParsed } from "./quote.promob";
import { PRICING_SETTING, calcToData, loadPricing, nextQuoteNumber, quoteInclude, quotePdf, serializeQuote } from "./quote.service";

const router = Router();
router.use(authenticate);

const DAY = 86400000;
/** Hoje no fuso da loja, como data de calendário. */
const todayDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
const money = z.coerce.number().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().max(max).optional().nullable();

const calcSchema = z.object({
  items: z
    .array(
      z.object({
        room: text(120),
        description: z.string().trim().min(1, "Descreva o item").max(3000),
        corpo: text(160),
        porta: text(160),
        puxador: text(160),
        complemento: text(160),
        modelo: text(160),
        quantity: z.coerce.number().positive().max(100000).optional(),
        unitCost: money,
      })
    )
    .min(1, "Inclua pelo menos um ambiente ou item")
    .max(200),
  markup: z.coerce.number().positive().max(20),
  commissions: z
    .array(z.object({ userId: z.string().optional().nullable(), referrerId: z.string().optional().nullable(), name: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(40), percent: z.coerce.number().min(0).max(50) }))
    .max(10)
    .default([]),
  discount: money.optional(),
  // alternativas ao desconto em R$: percentual sobre o preço, ou o valor final combinado
  discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  targetTotal: money.optional().nullable(),
  freight: money.optional(),
  otherCosts: money.optional(),
  payment: z.object({
    method: z.enum(PAYMENT_METHODS),
    planId: z.string().optional().nullable(),
    installments: z.coerce.number().int().min(1).max(120).optional().nullable(),
    downPayment: money.optional().nullable(),
    feePercent: z.coerce.number().min(0).max(50).optional().nullable(),
  }),
});

const quoteSchema = calcSchema.extend({
  clientId: z.string().min(1, "Escolha o cliente"),
  opportunityId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  referrerId: z.string().optional().nullable(),
  /** cria um adendo do contrato (orçamento aceito) informado */
  addendumOf: z.string().optional().nullable(),
  futureSale: z.boolean().optional(),
  futureReleaseDate: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  paymentTerms: text(1000),
  deliveryText: text(160),
  deliveryDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
  notes: text(4000),
});

function calc(input: z.infer<typeof calcSchema>, config: PricingConfig) {
  try {
    return computeQuote(input, config);
  } catch (e) {
    if (e instanceof QuoteRuleError) throw new BadRequestError(e.message);
    throw e;
  }
}

const canSeeAll = (req: Request) => req.user!.permissions.includes("commercial.read.all");

async function findQuote(req: Request, id: string) {
  const q = await prisma.commercialQuote.findFirst({
    where: { id, organizationId: req.user!.organizationId, ...(canSeeAll(req) ? {} : { sellerId: req.user!.id }) },
    include: quoteInclude,
  });
  if (!q) throw new NotFoundError("Orçamento não encontrado");
  return q;
}

/** Cliente, oportunidade e projeto precisam ser da organização (e o projeto, do cliente). */
async function checkRefs(orgId: string, input: { clientId: string; opportunityId?: string | null; projectId?: string | null; referrerId?: string | null; commissions?: { referrerId?: string | null }[] }) {
  const refIds = [...new Set([input.referrerId, ...(input.commissions ?? []).map((c) => c.referrerId)].filter((x): x is string => Boolean(x)))];
  if (refIds.length && (await prisma.referrer.count({ where: { id: { in: refIds }, organizationId: orgId } })) !== refIds.length) {
    throw new BadRequestError("Indicador inválido");
  }
  const [client, opp, project] = await Promise.all([
    prisma.client.findFirst({ where: { id: input.clientId, organizationId: orgId }, select: { id: true } }),
    input.opportunityId ? prisma.commercialOpportunity.findFirst({ where: { id: input.opportunityId, organizationId: orgId }, select: { id: true, clientId: true } }) : null,
    input.projectId ? prisma.project.findFirst({ where: { id: input.projectId, organizationId: orgId }, select: { id: true, clientId: true } }) : null,
  ]);
  if (!client) throw new BadRequestError("Cliente inválido");
  if (input.opportunityId && !opp) throw new BadRequestError("Oportunidade inválida");
  if (opp?.clientId && opp.clientId !== client.id) throw new BadRequestError("A oportunidade é de outro cliente");
  if (input.projectId && !project) throw new BadRequestError("Projeto inválido");
  if (project && project.clientId !== client.id) throw new BadRequestError("O projeto é de outro cliente");
}

async function audit(userId: string, action: string, entityId: string, details?: object) {
  await prisma.auditLog.create({ data: { userId, action, entity: "CommercialQuote", entityId, details } });
}

async function askApproval(req: Request, quoteId: string, number: string, score: number | null, minScore: number) {
  await notifyUsersWithPermission({
    organizationId: req.user!.organizationId,
    permission: "commercial.quotes.approve",
    title: `Orçamento ${number} aguarda liberação`,
    message: `${req.user!.name} fechou com pontuação ${score?.toFixed(2).replace(".", ",")} (mínimo ${minScore.toFixed(2).replace(".", ",")}).`,
    excludeUserId: req.user!.id,
  });
  await audit(req.user!.id, "QUOTE_APPROVAL_REQUESTED", quoteId, { score, minScore });
}

// ------------------------------------------------------------------ configuração

// GET /api/commercial/quotes/config
router.get(
  "/config",
  requirePermission("commercial.read"),
  asyncHandler(async (_req, res) => ok(res, await loadPricing()))
);

const planSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  method: z.enum(["CARTAO", "FINANCEIRA"]),
  installments: z.coerce.number().int().min(1).max(120),
  feePercent: z.coerce.number().min(0).max(50),
  requiresDownPayment: z.boolean().default(false),
});

// PUT /api/commercial/quotes/config
router.put(
  "/config",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        defaultMarkup: z.coerce.number().positive().max(20),
        minScore: z.coerce.number().positive().max(20),
        validityDays: z.coerce.number().int().min(1).max(365),
        commissionRoles: z.array(z.object({ role: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(60), defaultPercent: z.coerce.number().min(0).max(50) })).min(1).max(10),
        financingPlans: z.array(planSchema).max(30),
        document: z
          .object({
            supplier: z.string().trim().min(1).max(80),
            line: z.string().trim().min(1).max(60),
            deliveryDays: z.coerce.number().int().min(1).max(365),
            deliveryText: z.string().trim().min(1).max(120),
            mandatoryNote: z.string().trim().min(1).max(400).optional(),
            notes: z.array(z.string().trim().min(1).max(400)).max(15),
          })
          .optional(),
      })
      .parse(req.body);
    if (new Set(input.financingPlans.map((p) => p.id)).size !== input.financingPlans.length) throw new BadRequestError("Dois planos com o mesmo código");
    const value = JSON.stringify(normalizePricing(input));
    await prisma.setting.upsert({ where: { key: PRICING_SETTING }, create: { key: PRICING_SETTING, value }, update: { value } });
    await prisma.auditLog.create({ data: { userId: req.user!.id, action: "PRICING_CONFIG_UPDATED", entity: "Setting", entityId: PRICING_SETTING, details: input } });
    return ok(res, normalizePricing(input), "Configuração de preços salva");
  })
);

// ------------------------------------------------------------------ cálculo

// POST /api/commercial/quotes/preview — calcula sem gravar (a tela chama a cada alteração)
router.post(
  "/preview",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => ok(res, calc(calcSchema.parse(req.body), await loadPricing())))
);

// GET /api/commercial/quotes/promob/:importId — ambientes do Promob com o valor de cada um, para usar como custo
router.get(
  "/promob/:importId",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const imp = await prisma.promobImport.findFirst({
      where: { id: req.params.importId, organizationId: req.user!.organizationId },
      select: { id: true, fileName: true, totalValue: true, parsedJson: true },
    });
    if (!imp) throw new NotFoundError("Importação não encontrada");
    const rooms = roomsFromParsed(imp.parsedJson);
    const hasValues = hasBudgetValues(rooms);
    return ok(res, {
      fileName: imp.fileName,
      rooms: hasValues ? rooms : [],
      total: imp.totalValue == null ? null : Number(imp.totalValue),
      warning: hasValues ? null : "Este arquivo do Promob não traz valores por ambiente; informe o custo à mão.",
    });
  })
);

// ------------------------------------------------------------------ CRUD

// GET /api/commercial/quotes?clientId&opportunityId&status&approval=PENDING
router.get(
  "/",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const status = req.query.status && Object.values(QuoteStatus).includes(req.query.status as QuoteStatus) ? (req.query.status as QuoteStatus) : undefined;
    const rows = await prisma.commercialQuote.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(canSeeAll(req) ? {} : { sellerId: req.user!.id }),
        ...(req.query.clientId ? { clientId: String(req.query.clientId) } : {}),
        ...(req.query.opportunityId ? { opportunityId: String(req.query.opportunityId) } : {}),
        ...(status ? { status } : {}),
        ...(req.query.approval === "PENDING" ? { approvalStatus: "PENDING" as const } : {}),
        ...(req.query.future === "1" ? { futureSale: true } : {}),
      },
      include: quoteInclude,
      orderBy: [{ issuedAt: "desc" }, { version: "desc" }],
      take: 200,
    });
    return ok(res, rows.map(serializeQuote));
  })
);

router.get(
  "/:id",
  requirePermission("commercial.read"),
  asyncHandler(async (req, res) => {
    const q = await findQuote(req, req.params.id);
    const finance = await prisma.financeTransaction.findMany({
      where: { originQuoteId: q.id },
      select: { id: true, type: true, category: true, amount: true, dueDate: true, status: true, description: true },
      orderBy: [{ dueDate: "asc" }, { type: "desc" }],
    });
    return ok(res, { ...serializeQuote(q), finance: finance.map((f) => ({ ...f, amount: Number(f.amount) })) });
  })
);

// GET /api/commercial/quotes/:id/finance-preview — o que o aceite vai lançar no financeiro
router.get(
  "/:id/finance-preview",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const q = await findQuote(req, req.params.id);
    return ok(res, planFinance(serializeQuote(q), todayDay()));
  })
);

// POST /api/commercial/quotes
router.post(
  "/",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const input = quoteSchema.parse(req.body);
    await checkRefs(req.user!.organizationId, input);
    const config = await loadPricing();
    const c = calc(input, config);
    // Adendo: acréscimo a um contrato aceito, do mesmo cliente, numerado ORC-xxxxx-A1, A2...
    let parent: { id: string; number: string } | null = null;
    if (input.addendumOf) {
      const p = await findQuote(req, input.addendumOf);
      if (p.status !== "APPROVED" || p.kind !== "PADRAO") throw new BadRequestError("Adendo só de contrato aceito pelo cliente");
      if (p.clientId !== input.clientId) throw new BadRequestError("O adendo precisa ser do mesmo cliente do contrato");
      parent = { id: p.id, number: p.number };
    }
    const number = parent
      ? `${parent.number}-A${(await prisma.commercialQuote.count({ where: { organizationId: req.user!.organizationId, parentId: parent.id, kind: "ADENDO" } })) + 1}`
      : await nextQuoteNumber(req.user!.organizationId);
    const now = new Date();
    const created = await prisma.commercialQuote.create({
      data: {
        organizationId: req.user!.organizationId,
        number,
        kind: parent ? "ADENDO" : "PADRAO",
        parentId: parent?.id ?? null,
        futureSale: Boolean(input.futureSale),
        futureReleaseDate: input.futureSale ? input.futureReleaseDate ?? null : null,
        clientId: input.clientId,
        opportunityId: input.opportunityId || null,
        projectId: input.projectId || null,
        referrerId: input.referrerId || null,
        sellerId: req.user!.id,
        validUntil: input.validUntil ?? new Date(now.getTime() + config.validityDays * DAY),
        paymentTerms: input.paymentTerms || null,
        deliveryText: input.deliveryText || null,
        deliveryDays: input.deliveryDays ?? null,
        notes: input.notes || null,
        approvalStatus: c.needsApproval ? "PENDING" : "NOT_REQUIRED",
        approvalRequestedAt: c.needsApproval ? now : null,
        ...calcToData(c),
      },
      include: quoteInclude,
    });
    await audit(req.user!.id, "QUOTE_CREATED", created.id, { number, total: c.total, score: c.score });
    if (c.needsApproval) await askApproval(req, created.id, number, c.score, config.minScore);
    return ok(res, serializeQuote(created), c.needsApproval ? "Orçamento salvo — pontuação abaixo do mínimo, liberação solicitada" : "Orçamento salvo");
  })
);

const EDITABLE: QuoteStatus[] = ["DRAFT", "NEGOTIATION"];

// PUT /api/commercial/quotes/:id — regrava itens e cálculo; mexeu no preço, a liberação vale de novo
router.put(
  "/:id",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const cur = await findQuote(req, req.params.id);
    if (!EDITABLE.includes(cur.status)) throw new BadRequestError("Orçamento enviado ou fechado não se edita — crie uma nova versão");
    const input = quoteSchema.parse(req.body);
    await checkRefs(req.user!.organizationId, input);
    const config = await loadPricing();
    const c = calc(input, config);
    // Liberação dada continua valendo se a pontuação não caiu abaixo da que foi liberada.
    const keepsApproval = cur.approvalStatus === "APPROVED" && c.score != null && cur.score != null && c.score >= Number(cur.score);
    const approvalStatus = !c.needsApproval ? "NOT_REQUIRED" : keepsApproval ? "APPROVED" : "PENDING";
    const updated = await prisma.$transaction(async (tx) => {
      await tx.commercialQuoteItem.deleteMany({ where: { quoteId: cur.id } });
      await tx.commercialQuoteCommission.deleteMany({ where: { quoteId: cur.id } });
      return tx.commercialQuote.update({
        where: { id: cur.id },
        data: {
          clientId: input.clientId,
          opportunityId: input.opportunityId || null,
          projectId: input.projectId || null,
          referrerId: input.referrerId || null,
          futureSale: Boolean(input.futureSale),
          futureReleaseDate: input.futureSale ? input.futureReleaseDate ?? null : null,
          validUntil: input.validUntil ?? cur.validUntil,
          paymentTerms: input.paymentTerms || null,
          deliveryText: input.deliveryText || null,
          deliveryDays: input.deliveryDays ?? null,
          notes: input.notes || null,
          approvalStatus,
          ...(approvalStatus === "PENDING" && cur.approvalStatus !== "PENDING"
            ? { approvalRequestedAt: new Date(), approvalDecidedAt: null, approvalDecidedById: null, approvalNote: null }
            : {}),
          ...(approvalStatus === "NOT_REQUIRED" ? { approvalRequestedAt: null, approvalDecidedAt: null, approvalDecidedById: null, approvalNote: null } : {}),
          ...calcToData(c),
        },
        include: quoteInclude,
      });
    });
    await audit(req.user!.id, "QUOTE_UPDATED", cur.id, { total: c.total, score: c.score, approvalStatus });
    if (approvalStatus === "PENDING" && cur.approvalStatus !== "PENDING") await askApproval(req, cur.id, cur.number, c.score, config.minScore);
    return ok(res, serializeQuote(updated), "Orçamento atualizado");
  })
);

// POST /api/commercial/quotes/:id/version — cópia editável com o mesmo número e versão seguinte
router.post(
  "/:id/version",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const cur = await findQuote(req, req.params.id);
    const last = await prisma.commercialQuote.findFirst({
      where: { organizationId: req.user!.organizationId, number: cur.number },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const s = serializeQuote(cur);
    const config = await loadPricing();
    const c = calc(
      { items: s.items, markup: s.markup, commissions: s.commissions, discount: s.discount, discountPercent: s.discountPercent, targetTotal: s.targetTotal, freight: s.freight, otherCosts: s.otherCosts, payment: { ...s.payment, planId: config.financingPlans.some((p) => p.id === s.payment.planId) ? s.payment.planId : null } },
      config
    );
    const copy = await prisma.commercialQuote.create({
      data: {
        organizationId: cur.organizationId,
        number: cur.number,
        version: (last?.version ?? cur.version) + 1,
        kind: cur.kind,
        // versão de adendo continua apontando para o contrato; a de contrato, para a versão anterior
        parentId: cur.kind === "ADENDO" ? cur.parentId : cur.id,
        clientId: cur.clientId,
        opportunityId: cur.opportunityId,
        projectId: cur.projectId,
        referrerId: cur.referrerId,
        futureSale: cur.futureSale,
        futureReleaseDate: cur.futureReleaseDate,
        sellerId: cur.sellerId,
        validUntil: new Date(Date.now() + config.validityDays * DAY),
        paymentTerms: cur.paymentTerms,
        deliveryText: cur.deliveryText,
        deliveryDays: cur.deliveryDays,
        notes: cur.notes,
        approvalStatus: c.needsApproval ? "PENDING" : "NOT_REQUIRED",
        approvalRequestedAt: c.needsApproval ? new Date() : null,
        ...calcToData(c),
      },
      include: quoteInclude,
    });
    await audit(req.user!.id, "QUOTE_VERSIONED", copy.id, { from: cur.id, version: copy.version });
    return ok(res, serializeQuote(copy), `Versão ${copy.version} criada`);
  })
);

// POST /api/commercial/quotes/:id/approval { decision: APPROVE | REJECT, note }
router.post(
  "/:id/approval",
  requirePermission("commercial.quotes.approve"),
  asyncHandler(async (req, res) => {
    const { decision, note } = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: text(500) }).parse(req.body);
    const cur = await findQuote(req, req.params.id);
    if (cur.approvalStatus !== "PENDING") throw new BadRequestError("Este orçamento não está aguardando liberação");
    if (decision === "REJECT" && !note) throw new BadRequestError("Diga o motivo da recusa para o vendedor ajustar");
    const updated = await prisma.commercialQuote.update({
      where: { id: cur.id },
      data: { approvalStatus: decision === "APPROVE" ? "APPROVED" : "REJECTED", approvalDecidedAt: new Date(), approvalDecidedById: req.user!.id, approvalNote: note || null },
      include: quoteInclude,
    });
    await audit(req.user!.id, decision === "APPROVE" ? "QUOTE_APPROVED" : "QUOTE_APPROVAL_REJECTED", cur.id, { note });
    if (cur.sellerId !== req.user!.id) {
      await notifyUser(
        cur.sellerId,
        decision === "APPROVE" ? `Orçamento ${cur.number} liberado` : `Orçamento ${cur.number} não liberado`,
        decision === "APPROVE" ? `${req.user!.name} liberou a pontuação.${note ? ` ${note}` : ""}` : `${req.user!.name}: ${note}`
      );
    }
    return ok(res, serializeQuote(updated), decision === "APPROVE" ? "Orçamento liberado" : "Liberação recusada");
  })
);

/** Pontuação abaixo do mínimo sem liberação não sai para o cliente. */
function assertReleased(q: { approvalStatus: string }) {
  if (q.approvalStatus === "PENDING") throw new ForbiddenError("A pontuação está abaixo do mínimo e aguarda liberação");
  if (q.approvalStatus === "REJECTED") throw new ForbiddenError("A liberação foi recusada — ajuste o preço e salve de novo");
}

// POST /api/commercial/quotes/:id/pdf — gera e guarda o PDF nos documentos do cliente/projeto
router.post(
  "/:id/pdf",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const cur = await findQuote(req, req.params.id);
    assertReleased(cur);
    const s = serializeQuote(cur);
    const buffer = await quotePdf(s, req.user!.organizationId);
    const previous = await prisma.projectDocument.findFirst({
      where: { organizationId: cur.organizationId, generatedFrom: `quote:${cur.id}` },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    const doc = await storeGeneratedPdf({
      organizationId: cur.organizationId,
      clientId: cur.clientId,
      projectId: cur.projectId,
      type: "ORCAMENTO",
      generatedFrom: `quote:${cur.id}`,
      title: `Orçamento ${cur.number}${cur.version > 1 ? ` v${cur.version}` : ""}`,
      fileName: `orcamento-${cur.number.toLowerCase()}${cur.version > 1 ? `-v${cur.version}` : ""}.pdf`,
      buffer,
      visibleToClient: false,
      uploadedById: req.user!.id,
      replacesId: previous?.id ?? null,
    });
    await audit(req.user!.id, "QUOTE_PDF_GENERATED", cur.id, { documentId: doc.id });
    return ok(res, { documentId: doc.id, downloadUrl: `/api/documents/${doc.id}/download`, total: brl(s.total) }, "PDF do orçamento gerado");
  })
);

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const D2 = (n: number) => new Prisma.Decimal(n.toFixed(2));

type Tx = Prisma.TransactionClient;
type FinanceResult = { created: number; receivable: number; replacedOpportunityEntry: boolean; skipped?: string };

/**
 * Aceite do cliente: gera parcelas, taxas e comissões no financeiro. Uma vez
 * por orçamento. O recebível único criado quando a oportunidade foi ganha é
 * trocado pelas parcelas se ainda não teve pagamento.
 */
async function generateFinance(tx: Tx, q: ReturnType<typeof serializeQuote> & { organizationId: string }, userId: string): Promise<FinanceResult> {
  if (await tx.financeTransaction.findFirst({ where: { originQuoteId: q.id }, select: { id: true } })) {
    return { created: 0, receivable: 0, replacedOpportunityEntry: false, skipped: "o financeiro deste orçamento já foi gerado" };
  }
  let replaced = false;
  if (q.opportunity) {
    const oppEntries = await tx.financeTransaction.findMany({
      where: { originOpportunityId: q.opportunity.id, originQuoteId: null, type: "RECEITA" },
      select: { id: true, status: true, paidAmount: true },
    });
    if (oppEntries.some((e) => e.status === "PAGO" || Number(e.paidAmount) > 0)) {
      return { created: 0, receivable: 0, replacedOpportunityEntry: false, skipped: "a oportunidade já tem recebível com pagamento registrado — ajuste no financeiro" };
    }
    if (oppEntries.length) {
      await tx.financeTransaction.deleteMany({ where: { id: { in: oppEntries.map((e) => e.id) } } });
      replaced = true;
    }
  }
  const plan = planFinance(q, todayDay());
  const group = plan.filter((e) => e.installmentTotal).length ? crypto.randomUUID() : null;
  await tx.financeTransaction.createMany({
    data: plan.map((e) => ({
      organizationId: q.organizationId,
      type: e.type,
      category: e.category,
      amount: D2(e.amount),
      date: dayToDate(todayDay()),
      dueDate: dayToDate(e.dueDay),
      description: e.description,
      status: "PENDENTE" as const,
      method: e.method,
      installmentGroup: e.installmentTotal ? group : null,
      installmentNumber: e.installmentNumber,
      installmentTotal: e.installmentTotal,
      originQuoteId: q.id,
      referrerId: e.referrerId ?? null,
      originOpportunityId: q.opportunity?.id ?? null,
      clientId: q.client.id,
      projectId: q.project?.id ?? null,
      purchaseRef: `${q.number}${q.version > 1 ? ` v${q.version}` : ""}`,
      createdById: userId,
    })),
  });
  const receivable = plan.filter((e) => e.type === "RECEITA" && e.category === CATEGORY_SALE).reduce((s, e) => s + e.amount, 0);
  return { created: plan.length, receivable: Math.round(receivable * 100) / 100, replacedOpportunityEntry: replaced };
}

/** Desfaz o aceite: some com o que foi gerado, desde que nada tenha sido pago. */
async function removeFinance(tx: Tx, quoteId: string) {
  const rows = await tx.financeTransaction.findMany({ where: { originQuoteId: quoteId }, select: { id: true, status: true, paidAmount: true } });
  if (rows.some((r) => r.status === "PAGO" || Number(r.paidAmount) > 0)) {
    throw new BadRequestError("Há parcela com pagamento registrado no financeiro — estorne lá antes de desfazer o aceite");
  }
  await tx.financeTransaction.deleteMany({ where: { originQuoteId: quoteId } });
  return rows.length;
}

// PATCH /api/commercial/quotes/:id/status { status, generateFinance? }
router.patch(
  "/:id/status",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const { status, generateFinance: wantsFinance, reason } = z
      .object({
        status: z.enum(["DRAFT", "SENT", "NEGOTIATION", "APPROVED", "REJECTED", "CANCELLED"]),
        generateFinance: z.boolean().default(true),
        reason: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body);
    const cur = await findQuote(req, req.params.id);
    if (status === "SENT" || status === "APPROVED") assertReleased(cur);
    const accepting = status === "APPROVED" && cur.status !== "APPROVED";
    const leaving = cur.status === "APPROVED" && status !== "APPROVED";
    if (leaving && status === "CANCELLED" && !reason) throw new BadRequestError("Diga o motivo do cancelamento do contrato");
    const data: Prisma.CommercialQuoteUpdateInput = { status };
    if (status === "SENT" && !cur.sentAt) data.sentAt = new Date();
    if (accepting) {
      data.approvedAt = new Date();
      data.competenceDate = new Date();
      data.cancelledAt = null;
      data.cancelReason = null;
    }
    if (status === "CANCELLED") {
      data.cancelledAt = new Date();
      data.cancelReason = reason || null;
    }
    let finance: FinanceResult | null = null;
    let removed = 0;
    let superseded: string[] = [];
    const updated = await prisma.$transaction(async (tx) => {
      if (leaving) removed = await removeFinance(tx, cur.id);
      // Alteração de contrato = nova versão aceita: a versão aceita anterior sai de cena
      if (accepting && cur.kind === "PADRAO") {
        const older = await tx.commercialQuote.findMany({
          where: { organizationId: cur.organizationId, number: cur.number, kind: "PADRAO", status: "APPROVED", id: { not: cur.id } },
          select: { id: true, version: true },
        });
        for (const o of older) {
          removed += await removeFinance(tx, o.id);
          await tx.commercialQuote.update({ where: { id: o.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Substituída pela versão ${cur.version}` } });
        }
        superseded = older.map((o) => `v${o.version}`);
      }
      const q = await tx.commercialQuote.update({ where: { id: cur.id }, data, include: quoteInclude });
      if (accepting) {
        // Venda futura: o projeto fica segurado até a nova medição e a liberação.
        if (cur.futureSale && cur.projectId) {
          await tx.project.update({ where: { id: cur.projectId }, data: { futureSale: true, futureReleaseDate: cur.futureReleaseDate, futureReleasedAt: null } });
        }
        // Cliente aceitou: a oportunidade passa a valer o total fechado.
        if (cur.opportunityId) await tx.commercialOpportunity.update({ where: { id: cur.opportunityId }, data: { estimatedValue: cur.total } });
        if (wantsFinance) finance = await generateFinance(tx, { ...serializeQuote(q), organizationId: cur.organizationId }, req.user!.id);
      }
      return q;
    });
    await audit(req.user!.id, "QUOTE_STATUS_CHANGED", cur.id, { from: cur.status, to: status, finance, removed, superseded, reason });
    const f = finance as FinanceResult | null;
    const message = f
      ? f.skipped
        ? `Aceite registrado; financeiro não gerado: ${f.skipped}`
        : `Aceite registrado — ${f.created} lançamento(s) no financeiro (${brl(f.receivable)} a receber)${f.replacedOpportunityEntry ? ", no lugar do recebível único da oportunidade" : ""}${superseded.length ? `; ${superseded.join(", ")} substituída(s)` : ""}`
      : removed
        ? `Situação atualizada — ${removed} lançamento(s) do aceite removidos do financeiro`
        : "Situação do orçamento atualizada";
    return ok(res, { ...serializeQuote(updated), finance: f }, message);
  })
);

// POST /api/commercial/quotes/:id/competence { date } — transfere o mês da venda (comissões/DRE)
router.post(
  "/:id/competence",
  requirePermission("commercial.manage"),
  asyncHandler(async (req, res) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD") }).parse(req.body);
    const cur = await findQuote(req, req.params.id);
    if (cur.status !== "APPROVED") throw new BadRequestError("Só contrato aceito tem competência");
    const when = new Date(`${date}T12:00:00.000Z`);
    const [, moved] = await prisma.$transaction([
      prisma.commercialQuote.update({ where: { id: cur.id }, data: { competenceDate: when } }),
      // competência (date) dos lançamentos do contrato; o vencimento não muda
      prisma.financeTransaction.updateMany({ where: { originQuoteId: cur.id }, data: { date: when } }),
    ]);
    await audit(req.user!.id, "QUOTE_COMPETENCE_TRANSFERRED", cur.id, { from: cur.competenceDate ?? cur.approvedAt, to: date });
    return ok(res, { competenceDate: when, moved: moved.count }, `Venda transferida para ${date.split("-").reverse().join("/")} — ${moved.count} lançamento(s) na nova competência`);
  })
);

// DELETE /api/commercial/quotes/:id — só rascunho
router.delete(
  "/:id",
  requirePermission("commercial.quotes.manage"),
  asyncHandler(async (req, res) => {
    const cur = await findQuote(req, req.params.id);
    if (cur.status !== "DRAFT") throw new BadRequestError("Só rascunho pode ser excluído; os demais se cancelam");
    await prisma.commercialQuote.delete({ where: { id: cur.id } });
    await audit(req.user!.id, "QUOTE_DELETED", cur.id, { number: cur.number, version: cur.version });
    return ok(res, { deleted: true }, "Rascunho excluído");
  })
);

export default router;
