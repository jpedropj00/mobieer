-- Fase 8.3: medidas por ambiente com versões, diário de montagem, localização
-- no ponto do montador (com consentimento), jornada prevista e avaliação.
-- Aditiva e idempotente.

-- Ponto do montador: localização só com consentimento na hora do registro
ALTER TABLE "ContractorShift"
  ADD COLUMN IF NOT EXISTS "locationConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "checkInLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "checkInLng" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "checkInAccuracy" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "checkOutLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "checkOutLng" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "checkOutAccuracy" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "device" TEXT;

-- Jornada prevista do montador (8h por padrão), base do banco de horas
ALTER TABLE "Contractor" ADD COLUMN IF NOT EXISTS "expectedDailyMinutes" INTEGER NOT NULL DEFAULT 480;

-- Medidas por ambiente
CREATE TABLE IF NOT EXISTS "MeasurementRoom" (
  "id" TEXT NOT NULL,
  "measurementId" TEXT NOT NULL,
  "roomId" TEXT,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "widthMm" DECIMAL(10,1),
  "heightMm" DECIMAL(10,1),
  "depthMm" DECIMAL(10,1),
  "ceilingHeightMm" DECIMAL(10,1),
  "plumbingPoints" TEXT,
  "electricalPoints" TEXT,
  "interferences" TEXT,
  "notes" TEXT,
  "supersededById" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeasurementRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MeasurementRoom_supersededById_key" ON "MeasurementRoom"("supersededById");
CREATE INDEX IF NOT EXISTS "MeasurementRoom_measurementId_supersededById_idx" ON "MeasurementRoom"("measurementId", "supersededById");
CREATE INDEX IF NOT EXISTS "MeasurementRoom_roomId_idx" ON "MeasurementRoom"("roomId");
DO $$ BEGIN
  ALTER TABLE "MeasurementRoom" ADD CONSTRAINT "MeasurementRoom_measurementId_fkey"
    FOREIGN KEY ("measurementId") REFERENCES "MeasurementVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MeasurementRoom" ADD CONSTRAINT "MeasurementRoom_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "ProjectRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MeasurementRoom" ADD CONSTRAINT "MeasurementRoom_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "MeasurementRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MeasurementRoom" ADD CONSTRAINT "MeasurementRoom_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Diário de montagem
DO $$ BEGIN
  CREATE TYPE "DiaryAttachmentKind" AS ENUM ('FOTO', 'VIDEO', 'DOCUMENTO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InstallationDiaryEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractorId" TEXT,
  "roomId" TEXT,
  "authorId" TEXT,
  "progressPct" INTEGER,
  "description" TEXT NOT NULL,
  "problems" TEXT,
  "materialsUsed" TEXT,
  "missingParts" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationDiaryEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstallationDiaryEntry_progress_check" CHECK ("progressPct" IS NULL OR ("progressPct" >= 0 AND "progressPct" <= 100))
);
CREATE INDEX IF NOT EXISTS "InstallationDiaryEntry_projectId_createdAt_idx" ON "InstallationDiaryEntry"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "InstallationDiaryEntry_contractorId_createdAt_idx" ON "InstallationDiaryEntry"("contractorId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryEntry" ADD CONSTRAINT "InstallationDiaryEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryEntry" ADD CONSTRAINT "InstallationDiaryEntry_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryEntry" ADD CONSTRAINT "InstallationDiaryEntry_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryEntry" ADD CONSTRAINT "InstallationDiaryEntry_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "ProjectRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryEntry" ADD CONSTRAINT "InstallationDiaryEntry_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InstallationDiaryAttachment" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "kind" "DiaryAttachmentKind" NOT NULL DEFAULT 'FOTO',
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InstallationDiaryAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InstallationDiaryAttachment_entryId_idx" ON "InstallationDiaryAttachment"("entryId");
DO $$ BEGIN
  ALTER TABLE "InstallationDiaryAttachment" ADD CONSTRAINT "InstallationDiaryAttachment_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "InstallationDiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Avaliação do montador
CREATE TABLE IF NOT EXISTS "ContractorRating" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "quality" INTEGER NOT NULL,
  "deadline" INTEGER NOT NULL,
  "organizationScore" INTEGER NOT NULL,
  "finish" INTEGER NOT NULL,
  "service" INTEGER NOT NULL,
  "rework" BOOLEAN NOT NULL DEFAULT false,
  "reworkNotes" TEXT,
  "notes" TEXT,
  "ratedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorRating_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractorRating_scores_check" CHECK (
    "quality" BETWEEN 1 AND 5 AND "deadline" BETWEEN 1 AND 5 AND "organizationScore" BETWEEN 1 AND 5
    AND "finish" BETWEEN 1 AND 5 AND "service" BETWEEN 1 AND 5
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "ContractorRating_projectId_contractorId_key" ON "ContractorRating"("projectId", "contractorId");
CREATE INDEX IF NOT EXISTS "ContractorRating_contractorId_createdAt_idx" ON "ContractorRating"("contractorId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "ContractorRating" ADD CONSTRAINT "ContractorRating_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContractorRating" ADD CONSTRAINT "ContractorRating_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContractorRating" ADD CONSTRAINT "ContractorRating_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContractorRating" ADD CONSTRAINT "ContractorRating_ratedById_fkey"
    FOREIGN KEY ("ratedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
