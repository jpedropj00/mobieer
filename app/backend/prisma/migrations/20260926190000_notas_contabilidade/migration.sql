-- Notas enviadas pela contabilidade, só para registro (sem emitir pela
-- plataforma). A chave de acesso impede registrar a mesma nota duas vezes.
-- Aditiva e idempotente.

ALTER TABLE "FiscalInvoice"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'EMITIDA',
  ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'SAIDA',
  ADD COLUMN IF NOT EXISTS "accessKey" TEXT,
  ADD COLUMN IF NOT EXISTS "counterpartName" TEXT,
  ADD COLUMN IF NOT EXISTS "counterpartDocument" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "FiscalInvoice_organizationId_accessKey_key" ON "FiscalInvoice"("organizationId", "accessKey");
