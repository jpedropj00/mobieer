-- Segurança de acesso: bloqueio por tentativas, validade da senha e troca
-- obrigatória. Quem já existe conta como "trocou hoje" para a validade não
-- derrubar todo mundo no primeiro dia. Aditiva e idempotente.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "passwordChangedAt" = CURRENT_TIMESTAMP WHERE "passwordChangedAt" IS NULL;
