-- Requisição de montagem impressa com QR: o montador conclui os cômodos pela
-- página do token, sem login e sem papel. Aditiva e idempotente.

DO $$
BEGIN
  CREATE TYPE "InstallationWorkOrderStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "InstallationTask" ADD COLUMN IF NOT EXISTS "workOrderId" TEXT;

CREATE TABLE IF NOT EXISTS "InstallationWorkOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InstallationWorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "scheduledFor" TIMESTAMP(3),
    "instructions" TEXT,
    "receivedByName" TEXT,
    "clientSignature" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationWorkOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstallationWorkOrder_token_key" ON "InstallationWorkOrder"("token");
CREATE INDEX IF NOT EXISTS "InstallationWorkOrder_organizationId_status_idx" ON "InstallationWorkOrder"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "InstallationWorkOrder_contractorId_status_idx" ON "InstallationWorkOrder"("contractorId", "status");
CREATE INDEX IF NOT EXISTS "InstallationWorkOrder_projectId_idx" ON "InstallationWorkOrder"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "InstallationWorkOrder_organizationId_number_key" ON "InstallationWorkOrder"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "InstallationTask_workOrderId_idx" ON "InstallationTask"("workOrderId");

DO $$
BEGIN
  ALTER TABLE "InstallationTask" ADD CONSTRAINT "InstallationTask_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "InstallationWorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "InstallationWorkOrder" ADD CONSTRAINT "InstallationWorkOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "InstallationWorkOrder" ADD CONSTRAINT "InstallationWorkOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "InstallationWorkOrder" ADD CONSTRAINT "InstallationWorkOrder_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "InstallationWorkOrder" ADD CONSTRAINT "InstallationWorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
