-- CreateEnum
CREATE TYPE "FiscalInvoiceStatus" AS ENUM ('DRAFT', 'QUEUED', 'PROCESSING', 'ISSUED', 'REJECTED', 'CANCELLED', 'ERROR');

-- AlterTable: ProductionOrder ganha cronograma gerado
ALTER TABLE "ProductionOrder" ADD COLUMN "scheduleJson" JSONB,
    ADD COLUMN "scheduleSource" TEXT,
    ADD COLUMN "scheduleGeneratedAt" TIMESTAMP(3);

-- AlterTable: ProjectDocument ganha referência ao provedor de assinatura
ALTER TABLE "ProjectDocument" ADD COLUMN "signatureProvider" TEXT,
    ADD COLUMN "signatureProviderRef" TEXT,
    ADD COLUMN "signatureProviderUrl" TEXT,
    ADD COLUMN "signatureProviderStatus" TEXT;

-- CreateTable
CREATE TABLE "FiscalInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'NFE',
    "status" "FiscalInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "ref" TEXT NOT NULL,
    "provider" TEXT,
    "providerRef" TEXT,
    "number" TEXT,
    "series" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "payloadJson" JSONB,
    "resultJson" JSONB,
    "xmlKey" TEXT,
    "pdfKey" TEXT,
    "errorMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromobImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "parsedJson" JSONB,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromobImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalInvoice_ref_key" ON "FiscalInvoice"("ref");
CREATE INDEX "FiscalInvoice_organizationId_status_idx" ON "FiscalInvoice"("organizationId", "status");
CREATE INDEX "FiscalInvoice_projectId_idx" ON "FiscalInvoice"("projectId");
CREATE INDEX "PromobImport_organizationId_idx" ON "PromobImport"("organizationId");
CREATE INDEX "PromobImport_projectId_idx" ON "PromobImport"("projectId");

-- AddForeignKey
ALTER TABLE "FiscalInvoice" ADD CONSTRAINT "FiscalInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalInvoice" ADD CONSTRAINT "FiscalInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalInvoice" ADD CONSTRAINT "FiscalInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalInvoice" ADD CONSTRAINT "FiscalInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromobImport" ADD CONSTRAINT "PromobImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromobImport" ADD CONSTRAINT "PromobImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromobImport" ADD CONSTRAINT "PromobImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
