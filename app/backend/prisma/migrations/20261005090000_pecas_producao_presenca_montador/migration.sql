-- Solicitação de peças vai para a produção: o item da fábrica guarda de qual solicitação veio.
ALTER TABLE "ProductionItem" ADD COLUMN IF NOT EXISTS "partRequestId" TEXT;
CREATE INDEX IF NOT EXISTS "ProductionItem_partRequestId_idx" ON "ProductionItem"("partRequestId");
DO $$ BEGIN
  ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_partRequestId_fkey" FOREIGN KEY ("partRequestId") REFERENCES "PartRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Presença do montador externo lançada pelo escritório (veio / não veio), um registro por dia.
CREATE TABLE IF NOT EXISTS "ContractorAttendance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "present" BOOLEAN NOT NULL,
  "projectId" TEXT,
  "shiftId" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorAttendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractorAttendance_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContractorAttendance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ContractorAttendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ContractorShift"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContractorAttendance_contractorId_date_key" ON "ContractorAttendance"("contractorId", "date");
CREATE INDEX IF NOT EXISTS "ContractorAttendance_organizationId_date_idx" ON "ContractorAttendance"("organizationId", "date");
