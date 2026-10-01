-- Orçamento gerado a partir da importação do Promob: o vínculo permite
-- atualizar o mesmo rascunho quando o arquivo é reimportado. Aditiva e idempotente.

ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "promobImportId" TEXT;
CREATE INDEX IF NOT EXISTS "CommercialQuote_promobImportId_idx" ON "CommercialQuote"("promobImportId");

DO $$
BEGIN
  ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_promobImportId_fkey" FOREIGN KEY ("promobImportId") REFERENCES "PromobImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
