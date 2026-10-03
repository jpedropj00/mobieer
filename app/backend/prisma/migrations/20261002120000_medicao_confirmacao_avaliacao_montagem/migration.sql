-- Medição: o cliente confirma o dia/hora marcado ou pede outra data.
ALTER TABLE "MeasurementVisit" ADD COLUMN IF NOT EXISTS "clientConfirmedAt" TIMESTAMP(3);
ALTER TABLE "MeasurementVisit" ADD COLUMN IF NOT EXISTS "rescheduleRequestedAt" TIMESTAMP(3);

-- Montagem: nota (1 a 5) e comentário do cliente na conferência.
ALTER TABLE "InstallationWorkOrder" ADD COLUMN IF NOT EXISTS "clientRating" INTEGER;
ALTER TABLE "InstallationWorkOrder" ADD COLUMN IF NOT EXISTS "clientComment" TEXT;
