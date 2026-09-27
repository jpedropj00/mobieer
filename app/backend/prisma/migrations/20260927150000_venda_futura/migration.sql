-- Venda futura: vendida agora, produzida meses depois (após nova medição).
-- A ordem de produção só nasce depois da liberação. Aditiva e idempotente.

ALTER TABLE "CommercialQuote"
  ADD COLUMN IF NOT EXISTS "futureSale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "futureReleaseDate" TIMESTAMP(3);

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "futureSale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "futureReleaseDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "futureReleasedAt" TIMESTAMP(3);
