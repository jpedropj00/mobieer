-- AlterTable: liga a requisição de corte ao pedido de produção que a originou
ALTER TABLE "Requisition" ADD COLUMN "productionOrderId" TEXT;

-- CreateIndex
CREATE INDEX "Requisition_productionOrderId_idx" ON "Requisition"("productionOrderId");

-- AddForeignKey
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
