-- ============================================================
-- FASE 5 — Contrato automático, desenho da medição, feriados,
-- checklist de saída e montadores terceirizados.
-- ============================================================

-- AlterEnum: novos setores do chão de fábrica (antes da embalagem)
ALTER TYPE "ProductionSector" ADD VALUE IF NOT EXISTS 'ACABAMENTO' BEFORE 'EMBALAGEM';
ALTER TYPE "ProductionSector" ADD VALUE IF NOT EXISTS 'LIMPEZA' BEFORE 'EMBALAGEM';

-- CreateEnum
CREATE TYPE "MeasurementAttachmentKind" AS ENUM ('FILE', 'DRAWING');
CREATE TYPE "HolidayScope" AS ENUM ('NACIONAL', 'ESTADUAL', 'MUNICIPAL', 'EMPRESA');

-- AlterTable: modelo de documento pode ser corpo de texto com marcadores
ALTER TABLE "DocumentTemplate" ALTER COLUMN "storageKey" DROP NOT NULL;
ALTER TABLE "DocumentTemplate" ALTER COLUMN "fileName" DROP NOT NULL;
ALTER TABLE "DocumentTemplate" ALTER COLUMN "mimeType" DROP NOT NULL;
ALTER TABLE "DocumentTemplate" ALTER COLUMN "sizeBytes" DROP NOT NULL;
ALTER TABLE "DocumentTemplate" ADD COLUMN "bodyHtml" TEXT;

-- AlterTable: total do orçamento do Promob
ALTER TABLE "PromobImport" ADD COLUMN "totalValue" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "MeasurementAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "kind" "MeasurementAttachmentKind" NOT NULL DEFAULT 'FILE',
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "HolidayScope" NOT NULL DEFAULT 'EMPRESA',
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHoliday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HolidayNoticeLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayNoticeLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DispatchChecklist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "producaoCompleta" BOOLEAN NOT NULL DEFAULT false,
    "materialCompleto" BOOLEAN NOT NULL DEFAULT false,
    "ferragens" BOOLEAN NOT NULL DEFAULT false,
    "insumos" BOOLEAN NOT NULL DEFAULT false,
    "pendencia" BOOLEAN NOT NULL DEFAULT false,
    "pendenciaDescricao" TEXT,
    "notes" TEXT,
    "releasedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchChecklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "specialty" TEXT,
    "dailyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContractorShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "projectId" TEXT,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeasurementAttachment_organizationId_idx" ON "MeasurementAttachment"("organizationId");
CREATE INDEX "MeasurementAttachment_visitId_kind_idx" ON "MeasurementAttachment"("visitId", "kind");
CREATE UNIQUE INDEX "CompanyHoliday_organizationId_date_name_key" ON "CompanyHoliday"("organizationId", "date", "name");
CREATE INDEX "CompanyHoliday_organizationId_date_idx" ON "CompanyHoliday"("organizationId", "date");
CREATE UNIQUE INDEX "HolidayNoticeLog_organizationId_date_name_key" ON "HolidayNoticeLog"("organizationId", "date", "name");
CREATE INDEX "HolidayNoticeLog_organizationId_date_idx" ON "HolidayNoticeLog"("organizationId", "date");
CREATE UNIQUE INDEX "DispatchChecklist_orderId_key" ON "DispatchChecklist"("orderId");
CREATE INDEX "DispatchChecklist_organizationId_idx" ON "DispatchChecklist"("organizationId");
CREATE INDEX "Contractor_organizationId_active_idx" ON "Contractor"("organizationId", "active");
CREATE INDEX "ContractorShift_organizationId_checkInAt_idx" ON "ContractorShift"("organizationId", "checkInAt");
CREATE INDEX "ContractorShift_contractorId_checkInAt_idx" ON "ContractorShift"("contractorId", "checkInAt");
CREATE INDEX "ContractorShift_projectId_idx" ON "ContractorShift"("projectId");

-- AddForeignKey
ALTER TABLE "MeasurementAttachment" ADD CONSTRAINT "MeasurementAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeasurementAttachment" ADD CONSTRAINT "MeasurementAttachment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "MeasurementVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeasurementAttachment" ADD CONSTRAINT "MeasurementAttachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyHoliday" ADD CONSTRAINT "CompanyHoliday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyHoliday" ADD CONSTRAINT "CompanyHoliday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HolidayNoticeLog" ADD CONSTRAINT "HolidayNoticeLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DispatchChecklist" ADD CONSTRAINT "DispatchChecklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispatchChecklist" ADD CONSTRAINT "DispatchChecklist_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispatchChecklist" ADD CONSTRAINT "DispatchChecklist_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractorShift" ADD CONSTRAINT "ContractorShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractorShift" ADD CONSTRAINT "ContractorShift_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContractorShift" ADD CONSTRAINT "ContractorShift_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContractorShift" ADD CONSTRAINT "ContractorShift_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
