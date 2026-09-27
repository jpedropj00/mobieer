-- §37 Vistoria técnica pós-montagem (checklist real da Mobieer), §35/§38 garantia
-- por componente com certificado, §36 manutenção preventiva e dois eventos novos
-- de mensagem ao cliente.
--
-- ALTER TYPE ... ADD VALUE fica fora de bloco DO (o Postgres não aceita dentro).
-- Aditiva e idempotente.

DO $$
BEGIN
  CREATE TYPE "SiteInspectionStatus" AS ENUM ('DRAFT', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "SiteInspectionResult" AS ENUM ('APPROVED', 'APPROVED_WITH_REMARKS', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "InspectionItemStatus" AS ENUM ('CONFORME', 'NAO_CONFORME', 'NAO_APLICA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'MAINTENANCE_REMINDER';

ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'WARRANTY_EXPIRING';

CREATE TABLE IF NOT EXISTS "SiteInspection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "SiteInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "SiteInspectionResult",
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ambientes" TEXT,
    "technicianId" TEXT,
    "installerNames" TEXT,
    "pendencias" TEXT,
    "notes" TEXT,
    "technicianSignature" TEXT,
    "clientSignerName" TEXT,
    "clientSignature" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "reportDocumentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInspection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SiteInspectionItem" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "InspectionItemStatus",
    "note" TEXT,

    CONSTRAINT "SiteInspectionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Warranty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "coverage" JSONB NOT NULL,
    "conditions" TEXT NOT NULL,
    "exclusions" TEXT NOT NULL,
    "certificateDocumentId" TEXT,
    "alertsSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warranty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PreventiveMaintenance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "warrantyId" TEXT,
    "label" TEXT NOT NULL,
    "monthsAfter" INTEGER,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "remindedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreventiveMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SiteInspection_reportDocumentId_key" ON "SiteInspection"("reportDocumentId");

CREATE INDEX IF NOT EXISTS "SiteInspection_organizationId_status_idx" ON "SiteInspection"("organizationId", "status");

CREATE INDEX IF NOT EXISTS "SiteInspection_projectId_idx" ON "SiteInspection"("projectId");

CREATE INDEX IF NOT EXISTS "SiteInspectionItem_inspectionId_idx" ON "SiteInspectionItem"("inspectionId");

CREATE UNIQUE INDEX IF NOT EXISTS "Warranty_projectId_key" ON "Warranty"("projectId");

CREATE UNIQUE INDEX IF NOT EXISTS "Warranty_inspectionId_key" ON "Warranty"("inspectionId");

CREATE UNIQUE INDEX IF NOT EXISTS "Warranty_certificateDocumentId_key" ON "Warranty"("certificateDocumentId");

CREATE INDEX IF NOT EXISTS "Warranty_organizationId_endsAt_idx" ON "Warranty"("organizationId", "endsAt");

CREATE INDEX IF NOT EXISTS "PreventiveMaintenance_organizationId_status_dueAt_idx" ON "PreventiveMaintenance"("organizationId", "status", "dueAt");

CREATE INDEX IF NOT EXISTS "PreventiveMaintenance_projectId_idx" ON "PreventiveMaintenance"("projectId");

DO $$
BEGIN
  ALTER TABLE "SiteInspection" ADD CONSTRAINT "SiteInspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "SiteInspection" ADD CONSTRAINT "SiteInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "SiteInspection" ADD CONSTRAINT "SiteInspection_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "SiteInspection" ADD CONSTRAINT "SiteInspection_reportDocumentId_fkey" FOREIGN KEY ("reportDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "SiteInspection" ADD CONSTRAINT "SiteInspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "SiteInspectionItem" ADD CONSTRAINT "SiteInspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "SiteInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "SiteInspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_certificateDocumentId_fkey" FOREIGN KEY ("certificateDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "Warranty" ADD CONSTRAINT "Warranty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "PreventiveMaintenance" ADD CONSTRAINT "PreventiveMaintenance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "PreventiveMaintenance" ADD CONSTRAINT "PreventiveMaintenance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "PreventiveMaintenance" ADD CONSTRAINT "PreventiveMaintenance_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "Warranty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "PreventiveMaintenance" ADD CONSTRAINT "PreventiveMaintenance_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;


-- ============================================================
-- Permissões
-- ============================================================
INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_inspections_manage', 'inspections.manage', 'Registrar vistorias técnicas pós-montagem', 'Pós-venda', CURRENT_TIMESTAMP),
  ('perm_warranty_manage',    'warranty.manage',    'Gerenciar garantias, certificados e manutenções preventivas', 'Pós-venda', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN', 'inspections.manage'), ('ADMIN', 'warranty.manage'),
  ('MANAGER', 'inspections.manage'), ('MANAGER', 'warranty.manage'),
  ('TECNICO', 'inspections.manage'),
  ('ASSISTENCIA', 'inspections.manage'), ('ASSISTENCIA', 'warranty.manage')
) AS want(role_name, perm_code) ON want.role_name = r."name"
JOIN "Permission" p ON p."code" = want.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
