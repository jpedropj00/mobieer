-- CreateEnum
CREATE TYPE "ApplianceSheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');

-- CreateTable
CREATE TABLE "ApplianceSheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ApplianceSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "projetista" TEXT,
    "ambientes" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplianceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplianceItem" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owned" BOOLEAN NOT NULL DEFAULT false,
    "willBuy" BOOLEAN NOT NULL DEFAULT false,
    "brandModel" TEXT,
    "widthCm" DECIMAL(6,1),
    "heightCm" DECIMAL(6,1),
    "depthCm" DECIMAL(6,1),
    "referenceUrl" TEXT,
    "notes" TEXT,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApplianceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplianceSheet_projectId_key" ON "ApplianceSheet"("projectId");
CREATE INDEX "ApplianceSheet_organizationId_idx" ON "ApplianceSheet"("organizationId");
CREATE INDEX "ApplianceItem_sheetId_idx" ON "ApplianceItem"("sheetId");

-- AddForeignKey
ALTER TABLE "ApplianceSheet" ADD CONSTRAINT "ApplianceSheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplianceSheet" ADD CONSTRAINT "ApplianceSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplianceSheet" ADD CONSTRAINT "ApplianceSheet_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplianceItem" ADD CONSTRAINT "ApplianceItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ApplianceSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
