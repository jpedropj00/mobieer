-- Grade de montagem: dias ocupados, ajudantes e montagem extra na requisição;
-- montador titular ou ajudante no cadastro. Aditiva e idempotente.

ALTER TABLE "InstallationWorkOrder"
  ADD COLUMN IF NOT EXISTS "days" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "helperIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'MONTAGEM';

ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "crewRole" TEXT NOT NULL DEFAULT 'MONTADOR';

CREATE INDEX IF NOT EXISTS "InstallationWorkOrder_organizationId_scheduledFor_idx" ON "InstallationWorkOrder"("organizationId", "scheduledFor");
