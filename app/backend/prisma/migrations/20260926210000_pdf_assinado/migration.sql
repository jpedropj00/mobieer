-- Cópia assinada dos documentos: o original com carimbo em cada página e a
-- página de assinaturas no fim. Aditiva e idempotente.

ALTER TABLE "ProjectDocument"
  ADD COLUMN IF NOT EXISTS "signedStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "signedChecksum" TEXT,
  ADD COLUMN IF NOT EXISTS "signedFileAt" TIMESTAMP(3);

ALTER TABLE "ContractorDocument"
  ADD COLUMN IF NOT EXISTS "signedStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "signedChecksum" TEXT;
