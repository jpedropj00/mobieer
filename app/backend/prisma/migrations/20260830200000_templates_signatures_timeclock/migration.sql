-- CreateEnum
CREATE TYPE "DocumentSignatureStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SIGNED');

-- CreateEnum
CREATE TYPE "TimeEntryKind" AS ENUM ('IN', 'OUT', 'BREAK_OUT', 'BREAK_IN');

-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('DEVICE_IMPORT', 'MANUAL');

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProjectDocumentType" NOT NULL DEFAULT 'OUTRO',
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    "signerRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibleToClient" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTemplate_organizationId_active_idx" ON "DocumentTemplate"("organizationId", "active");

-- AlterTable
ALTER TABLE "ProjectDocument"
    ALTER COLUMN "projectId" DROP NOT NULL,
    ADD COLUMN "templateId" TEXT,
    ADD COLUMN "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "signerRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "signatureStatus" "DocumentSignatureStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "DocumentSignature" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "signedByUserId" TEXT,
    "signedByClientAccountId" TEXT,
    "ip" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSignature_documentId_idx" ON "DocumentSignature"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSignature_documentId_role_key" ON "DocumentSignature"("documentId", "role");

-- CreateTable
CREATE TABLE "TimeClockDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'KNUP KP-1028',
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeClockDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeClockDevice_organizationId_idx" ON "TimeClockDevice"("organizationId");

-- CreateTable
CREATE TABLE "TimeEntryImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowsOk" INTEGER NOT NULL DEFAULT 0,
    "rowsError" INTEGER NOT NULL DEFAULT 0,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntryImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntryImport_organizationId_createdAt_idx" ON "TimeEntryImport"("organizationId", "createdAt");

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "kind" "TimeEntryKind" NOT NULL,
    "source" "TimeEntrySource" NOT NULL DEFAULT 'DEVICE_IMPORT',
    "importId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_timestamp_idx" ON "TimeEntry"("organizationId", "timestamp");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_timestamp_idx" ON "TimeEntry"("employeeId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_employeeId_timestamp_key" ON "TimeEntry"("employeeId", "timestamp");

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSignature" ADD CONSTRAINT "DocumentSignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "TimeEntryImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
