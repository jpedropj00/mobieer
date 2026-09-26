-- Contrato: adendo (orçamento filho de um contrato aceito), mês de competência
-- da venda (transferível) e motivo do cancelamento. Aditiva e idempotente.

ALTER TABLE "CommercialQuote"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PADRAO',
  ADD COLUMN IF NOT EXISTS "competenceDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
