-- CreateEnum
CREATE TYPE "ProductionItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionSector" AS ENUM ('CORTE', 'FITA_BORDA', 'FURACAO', 'PRE_MONTAGEM', 'EMBALAGEM', 'EXPEDICAO');

-- CreateTable
CREATE TABLE "ProductionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "ambiente" TEXT,
    "descricao" TEXT NOT NULL,
    "referencia" TEXT,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "material" TEXT,
    "status" "ProductionItemStatus" NOT NULL DEFAULT 'PENDING',
    "sector" "ProductionSector",
    "sourceImportId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionItemEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sector" "ProductionSector",
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionItem_organizationId_status_sector_idx" ON "ProductionItem"("organizationId", "status", "sector");
CREATE INDEX "ProductionItem_orderId_idx" ON "ProductionItem"("orderId");
CREATE INDEX "ProductionItemEvent_itemId_idx" ON "ProductionItemEvent"("itemId");

-- AddForeignKey
ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionItem" ADD CONSTRAINT "ProductionItem_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "PromobImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionItemEvent" ADD CONSTRAINT "ProductionItemEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProductionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionItemEvent" ADD CONSTRAINT "ProductionItemEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
