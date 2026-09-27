-- §23/§24 — Etapas do pedido na fábrica com responsável e prazo.
-- §55 — Registro central de arquivos (FileRecord), usado primeiro pelos anexos das etapas.
--
-- As etapas dos pedidos que já existem são criadas pelo backend na primeira
-- leitura (ensureSteps), com prazo calculado a partir da liberação.
--
-- Aditiva e idempotente.

DO $$
BEGIN
  CREATE TYPE "ProductionStepKey" AS ENUM ('PLANO_CORTE', 'CORTE', 'FITA_BORDA', 'PECAS_ESPECIAIS', 'LIMPEZA', 'EMBALAGEM', 'PRE_MONTAGEM', 'LIBERACAO', 'SAIDA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ProductionStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'SKIPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "ProductionStep" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "step" "ProductionStepKey" NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "ProductionStepStatus" NOT NULL DEFAULT 'PENDING',
    "responsibleId" TEXT,
    "startedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "blockedReason" TEXT,
    "lastAlertKind" TEXT,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FileRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "category" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductionStep_status_dueAt_idx" ON "ProductionStep"("status", "dueAt");

CREATE INDEX IF NOT EXISTS "ProductionStep_responsibleId_idx" ON "ProductionStep"("responsibleId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionStep_orderId_step_key" ON "ProductionStep"("orderId", "step");

CREATE INDEX IF NOT EXISTS "FileRecord_organizationId_entity_entityId_idx" ON "FileRecord"("organizationId", "entity", "entityId");

CREATE INDEX IF NOT EXISTS "FileRecord_projectId_idx" ON "FileRecord"("projectId");

CREATE INDEX IF NOT EXISTS "FileRecord_clientId_idx" ON "FileRecord"("clientId");

DO $$
BEGIN
  ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
