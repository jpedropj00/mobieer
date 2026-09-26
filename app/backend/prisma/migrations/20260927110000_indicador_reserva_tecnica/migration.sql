-- Indicador da venda (arquiteto/parceiro) e a reserva técnica (RT) que ele
-- recebe: vai no orçamento como comissão e vira conta a pagar no aceite.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "Referrer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ARQUITETO',
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "pixKey" TEXT,
    "defaultRtPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referrer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Referrer_organizationId_active_idx" ON "Referrer"("organizationId", "active");

ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "referrerId" TEXT;
ALTER TABLE "CommercialQuoteCommission" ADD COLUMN IF NOT EXISTS "referrerId" TEXT;
ALTER TABLE "FinanceTransaction" ADD COLUMN IF NOT EXISTS "referrerId" TEXT;
CREATE INDEX IF NOT EXISTS "FinanceTransaction_referrerId_idx" ON "FinanceTransaction"("referrerId");

DO $$
BEGIN
  ALTER TABLE "Referrer" ADD CONSTRAINT "Referrer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CommercialQuoteCommission" ADD CONSTRAINT "CommercialQuoteCommission_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Referrer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
