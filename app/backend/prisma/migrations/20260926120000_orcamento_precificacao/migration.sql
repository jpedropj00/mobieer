-- Orçamento com formação de preço: custo, mark-up, comissões por dentro,
-- financeira, pontuação e liberação abaixo do mínimo. Aditiva e idempotente.

DO $$
BEGIN
  CREATE TYPE "QuoteApproval" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signatureImage" TEXT;

ALTER TABLE "CommercialQuote"
  ADD COLUMN IF NOT EXISTS "costTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "markup" DECIMAL(8,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "commissionPercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "freight" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "otherCosts" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT 'AVISTA',
  ADD COLUMN IF NOT EXISTS "financingPlanId" TEXT,
  ADD COLUMN IF NOT EXISTS "financingPlanName" TEXT,
  ADD COLUMN IF NOT EXISTS "installments" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "downPayment" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "financingFeePercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "financingFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "netRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "result" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "score" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "approvalStatus" "QuoteApproval" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS "approvalRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalDecidedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalNote" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;

ALTER TABLE "CommercialQuoteItem"
  ADD COLUMN IF NOT EXISTS "room" TEXT,
  ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "CommercialQuoteCommission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "percent" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "CommercialQuoteCommission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CommercialQuoteCommission_quoteId_idx" ON "CommercialQuoteCommission"("quoteId");
CREATE INDEX IF NOT EXISTS "CommercialQuoteCommission_userId_idx" ON "CommercialQuoteCommission"("userId");

DO $$
BEGIN
  ALTER TABLE "CommercialQuoteCommission" ADD CONSTRAINT "CommercialQuoteCommission_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CommercialQuoteCommission" ADD CONSTRAINT "CommercialQuoteCommission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_approvalDecidedById_fkey" FOREIGN KEY ("approvalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_com_quotes_approve', 'commercial.quotes.approve', 'Liberar orçamento com pontuação abaixo do mínimo', 'Comercial', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Quem libera é a gestão; o vendedor só pede.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN', 'commercial.quotes.approve'),
  ('MANAGER', 'commercial.quotes.approve'),
  ('COMERCIAL', 'commercial.quotes.approve')
) AS want(role_name, perm_code) ON want.role_name = r."name"
JOIN "Permission" p ON p."code" = want.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
