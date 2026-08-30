import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../../middlewares/auth";
import { requirePermission } from "../../middlewares/rbac";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../../utils/ApiError";
import { ok } from "../../utils/response";
import { apurar, enterpriseForOrg, faturamentoRealizado } from "./tax.service";

const router = Router();
router.use(authenticate);

const REGIMES = ["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"] as const;
const TIPOS = ["DAS", "IRPJ", "CSLL", "PIS", "COFINS", "ISS", "ICMS"] as const;

const ruleSchema = z.object({
  regimeTributario: z.enum(REGIMES),
  tipoImposto: z.enum(TIPOS),
  cnae: z.string().trim().max(20).optional().nullable().or(z.literal("")),
  uf: z.string().trim().length(2).optional().nullable().or(z.literal("")),
  aliquota: z.coerce.number().min(0).max(1), // fração
  reducaoBase: z.coerce.number().min(0).max(1).optional().nullable(),
  faixaFaturamentoMin: z.coerce.number().min(0).optional().nullable(),
  faixaFaturamentoMax: z.coerce.number().min(0).optional().nullable(),
  descricao: z.string().trim().max(255).optional().nullable().or(z.literal("")),
  ativo: z.boolean().default(true),
  vigenciaInicio: z.coerce.date().optional(),
  vigenciaFim: z.coerce.date().optional().nullable(),
});

const dec = (n: number | null | undefined) => (n == null ? null : new Prisma.Decimal(n));

// ---- Identidade fiscal da empresa (econofinance: companies) ----
router.get(
  "/company",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const e = await enterpriseForOrg(req.user!.organizationId);
    return ok(res, {
      legalName: e.legalName,
      tradeName: e.tradeName,
      document: e.document,
      regimeTributario: e.regimeTributario,
      cnae: e.cnae,
      uf: e.uf,
      municipio: e.municipio,
      inscricaoEstadual: e.inscricaoEstadual,
    });
  })
);

router.patch(
  "/company",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        regimeTributario: z.enum(REGIMES).optional(),
        cnae: z.string().trim().max(20).optional().nullable().or(z.literal("")),
        uf: z.string().trim().max(2).optional().nullable().or(z.literal("")),
        municipio: z.string().trim().max(120).optional().nullable().or(z.literal("")),
        inscricaoEstadual: z.string().trim().max(30).optional().nullable().or(z.literal("")),
      })
      .parse(req.body);
    const e = await enterpriseForOrg(req.user!.organizationId);
    const updated = await prisma.enterprise.update({
      where: { id: e.id },
      data: {
        regimeTributario: input.regimeTributario,
        cnae: input.cnae === undefined ? undefined : input.cnae || null,
        uf: input.uf === undefined ? undefined : (input.uf || null)?.toUpperCase() ?? null,
        municipio: input.municipio === undefined ? undefined : input.municipio || null,
        inscricaoEstadual: input.inscricaoEstadual === undefined ? undefined : input.inscricaoEstadual || null,
      },
    });
    await prisma.auditLog.create({
      data: { userId: req.user!.id, action: "TAX_COMPANY_UPDATED", entity: "Enterprise", entityId: e.id, details: input },
    });
    return ok(res, { regimeTributario: updated.regimeTributario, cnae: updated.cnae, uf: updated.uf, municipio: updated.municipio, inscricaoEstadual: updated.inscricaoEstadual }, "Dados fiscais atualizados");
  })
);

// ---- Regras fiscais (econofinance: tax_rules) ----
router.get(
  "/rules",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.taxRule.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: [{ regimeTributario: "asc" }, { faixaFaturamentoMin: "asc" }, { tipoImposto: "asc" }],
    });
    return ok(
      res,
      rows.map((r) => ({
        ...r,
        aliquota: Number(r.aliquota),
        reducaoBase: r.reducaoBase == null ? null : Number(r.reducaoBase),
        faixaFaturamentoMin: r.faixaFaturamentoMin == null ? null : Number(r.faixaFaturamentoMin),
        faixaFaturamentoMax: r.faixaFaturamentoMax == null ? null : Number(r.faixaFaturamentoMax),
      }))
    );
  })
);

router.post(
  "/rules",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const input = ruleSchema.parse(req.body);
    const r = await prisma.taxRule.create({
      data: {
        organizationId: req.user!.organizationId,
        regimeTributario: input.regimeTributario,
        tipoImposto: input.tipoImposto,
        cnae: input.cnae || null,
        uf: (input.uf || null)?.toUpperCase() ?? null,
        aliquota: new Prisma.Decimal(input.aliquota),
        reducaoBase: dec(input.reducaoBase ?? null),
        faixaFaturamentoMin: dec(input.faixaFaturamentoMin ?? null),
        faixaFaturamentoMax: dec(input.faixaFaturamentoMax ?? null),
        descricao: input.descricao || null,
        ativo: input.ativo,
        vigenciaInicio: input.vigenciaInicio ?? new Date(),
        vigenciaFim: input.vigenciaFim ?? null,
      },
    });
    return ok(res, { id: r.id }, "Regra fiscal criada");
  })
);

router.patch(
  "/rules/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.taxRule.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!current) throw new NotFoundError("Regra não encontrada");
    const input = ruleSchema.partial().parse(req.body);
    const r = await prisma.taxRule.update({
      where: { id: current.id },
      data: {
        regimeTributario: input.regimeTributario,
        tipoImposto: input.tipoImposto,
        cnae: input.cnae === undefined ? undefined : input.cnae || null,
        uf: input.uf === undefined ? undefined : (input.uf || null)?.toUpperCase() ?? null,
        aliquota: input.aliquota === undefined ? undefined : new Prisma.Decimal(input.aliquota),
        reducaoBase: input.reducaoBase === undefined ? undefined : dec(input.reducaoBase ?? null),
        faixaFaturamentoMin: input.faixaFaturamentoMin === undefined ? undefined : dec(input.faixaFaturamentoMin ?? null),
        faixaFaturamentoMax: input.faixaFaturamentoMax === undefined ? undefined : dec(input.faixaFaturamentoMax ?? null),
        descricao: input.descricao === undefined ? undefined : input.descricao || null,
        ativo: input.ativo,
        vigenciaInicio: input.vigenciaInicio,
        vigenciaFim: input.vigenciaFim === undefined ? undefined : input.vigenciaFim,
      },
    });
    return ok(res, { id: r.id }, "Regra atualizada");
  })
);

router.delete(
  "/rules/:id",
  requirePermission("finance.manage"),
  asyncHandler(async (req, res) => {
    const current = await prisma.taxRule.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!current) throw new NotFoundError("Regra não encontrada");
    await prisma.taxRule.delete({ where: { id: current.id } });
    return ok(res, { id: current.id }, "Regra removida");
  })
);

// ---- Apuração (econofinance: POST /tax-engine/apurar) ----
router.post(
  "/apurar",
  requirePermission("finance.read"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        faturamentoMensal: z.coerce.number().positive().optional(),
        competencia: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(req.body);

    const now = new Date();
    const competencia = input.competencia ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    let faturamento = new Prisma.Decimal(input.faturamentoMensal ?? 0);
    if (input.faturamentoMensal == null) {
      faturamento = await faturamentoRealizado(req.user!.organizationId, competencia);
    }
    if (faturamento.lte(0)) throw new BadRequestError("Faturamento zero na competência — informe um valor manualmente.");

    const result = await apurar({ organizationId: req.user!.organizationId, faturamento, competencia });
    return ok(res, result);
  })
);

export default router;
