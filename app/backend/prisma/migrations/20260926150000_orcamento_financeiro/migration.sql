-- Lançamentos gerados pelo aceite do orçamento apontam para ele: evita gerar
-- duas vezes e permite desfazer se o aceite for cancelado. Aditiva e idempotente.

ALTER TABLE "FinanceTransaction" ADD COLUMN IF NOT EXISTS "originQuoteId" TEXT;

CREATE INDEX IF NOT EXISTS "FinanceTransaction_originQuoteId_idx" ON "FinanceTransaction"("originQuoteId");

DO $$
BEGIN
  ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_originQuoteId_fkey" FOREIGN KEY ("originQuoteId") REFERENCES "CommercialQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
