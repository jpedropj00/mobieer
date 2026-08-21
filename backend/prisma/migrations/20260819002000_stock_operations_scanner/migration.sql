ALTER TYPE "MovementType" ADD VALUE 'TRANSFER';
ALTER TYPE "MovementType" ADD VALUE 'RESERVE';
ALTER TYPE "MovementType" ADD VALUE 'RELEASE';
ALTER TYPE "MovementType" ADD VALUE 'RETURN';
ALTER TYPE "MovementType" ADD VALUE 'LOSS';
ALTER TYPE "MovementType" ADD VALUE 'DAMAGE';

CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'FULFILLED', 'CANCELLED');

ALTER TABLE "Category" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT,
  ADD COLUMN "qrCode" TEXT,
  ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StockMovement" ADD COLUMN "originWarehouseId" TEXT,
  ADD COLUMN "destinationWarehouseId" TEXT,
  ADD COLUMN "reservationId" TEXT,
  ADD COLUMN "operationCode" TEXT;

CREATE TABLE "ProductWarehouseStock" (
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductWarehouseStock_pkey" PRIMARY KEY ("productId", "warehouseId")
);

CREATE TABLE "StockReservation" (
  "id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "note" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT,
  "requesterId" TEXT NOT NULL,
  CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE UNIQUE INDEX "Product_qrCode_key" ON "Product"("qrCode");
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");
CREATE INDEX "Product_qrCode_idx" ON "Product"("qrCode");
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");
CREATE INDEX "ProductWarehouseStock_warehouseId_idx" ON "ProductWarehouseStock"("warehouseId");
CREATE INDEX "StockReservation_productId_status_idx" ON "StockReservation"("productId", "status");
CREATE INDEX "StockReservation_requesterId_idx" ON "StockReservation"("requesterId");

ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductWarehouseStock" ADD CONSTRAINT "ProductWarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductWarehouseStock" ADD CONSTRAINT "ProductWarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_originWarehouseId_fkey" FOREIGN KEY ("originWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "StockReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProductWarehouseStock" ("productId", "warehouseId", "quantity", "updatedAt")
SELECT "id", "warehouseId", "stock", CURRENT_TIMESTAMP
FROM "Product"
WHERE "warehouseId" IS NOT NULL
ON CONFLICT ("productId", "warehouseId") DO NOTHING;

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_stock_transfer', 'stock.transfer', 'Transferir estoque', 'Estoque', CURRENT_TIMESTAMP),
  ('perm_stock_reserve', 'stock.reserve', 'Gerenciar reservas', 'Estoque', CURRENT_TIMESTAMP),
  ('perm_stock_occurrence', 'stock.occurrence', 'Registrar devoluções, perdas e avarias', 'Estoque', CURRENT_TIMESTAMP),
  ('perm_stock_scanner', 'stock.scanner', 'Usar scanner', 'Estoque', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" IN ('ADMIN', 'MANAGER', 'WAREHOUSE')
  AND p."code" IN ('stock.transfer', 'stock.reserve', 'stock.occurrence', 'stock.scanner')
ON CONFLICT DO NOTHING;
