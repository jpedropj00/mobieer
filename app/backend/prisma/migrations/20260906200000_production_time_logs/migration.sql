-- AlterTable: plano de corte oficial do pedido
ALTER TABLE "ProductionOrder" ADD COLUMN "cutPlanImportId" TEXT;
CREATE INDEX "ProductionOrder_cutPlanImportId_idx" ON "ProductionOrder"("cutPlanImportId");
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_cutPlanImportId_fkey" FOREIGN KEY ("cutPlanImportId") REFERENCES "PromobImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ProductionTimeLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sector" "ProductionSector" NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionTimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionTimeLog_itemId_idx" ON "ProductionTimeLog"("itemId");
CREATE INDEX "ProductionTimeLog_organizationId_startedAt_idx" ON "ProductionTimeLog"("organizationId", "startedAt");
CREATE INDEX "ProductionTimeLog_userId_endedAt_idx" ON "ProductionTimeLog"("userId", "endedAt");

-- AddForeignKey
ALTER TABLE "ProductionTimeLog" ADD CONSTRAINT "ProductionTimeLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionTimeLog" ADD CONSTRAINT "ProductionTimeLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProductionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionTimeLog" ADD CONSTRAINT "ProductionTimeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
