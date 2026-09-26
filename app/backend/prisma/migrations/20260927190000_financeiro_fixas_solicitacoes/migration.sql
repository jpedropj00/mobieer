-- Despesas/receitas fixas (parcela mensal) e solicitação de débito/crédito
-- com aprovação do financeiro. Aditiva e idempotente.

ALTER TABLE "FinanceTransaction" ADD COLUMN IF NOT EXISTS "recurringId" TEXT,
ADD COLUMN IF NOT EXISTS "recurringMonth" TEXT;

CREATE TABLE IF NOT EXISTS "FinanceRecurring" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL DEFAULT 'DESPESA',
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 10,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "method" TEXT,
    "supplierId" TEXT,
    "costCenterId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceRecurring_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinanceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "supplierName" TEXT,
    "projectId" TEXT,
    "clientId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinanceRecurring_organizationId_active_idx" ON "FinanceRecurring"("organizationId", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "FinanceRequest_transactionId_key" ON "FinanceRequest"("transactionId");

CREATE INDEX IF NOT EXISTS "FinanceRequest_organizationId_status_idx" ON "FinanceRequest"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "FinanceRequest_requestedById_idx" ON "FinanceRequest"("requestedById");

CREATE UNIQUE INDEX IF NOT EXISTS "FinanceTransaction_recurringId_recurringMonth_key" ON "FinanceTransaction"("recurringId", "recurringMonth");

DO $$
BEGIN
  ALTER TABLE "FinanceRecurring" ADD CONSTRAINT "FinanceRecurring_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FinanceRequest" ADD CONSTRAINT "FinanceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FinanceRequest" ADD CONSTRAINT "FinanceRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "FinanceRecurring"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_finance_request', 'finance.request', 'Solicitar lançamento (débito/crédito) ao financeiro', 'Financeiro', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Quem trabalha na loja pode pedir; aprovar é de quem gerencia o financeiro.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'finance.request'
WHERE r."name" IN ('ADMIN', 'MANAGER', 'FINANCEIRO', 'COMERCIAL', 'CONSULTOR', 'PROJETISTA', 'PRODUCTION', 'COMPRAS', 'RH', 'ASSISTENCIA', 'WAREHOUSE', 'TECNICO')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
