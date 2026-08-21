-- Evolve the existing stock requisition into the Gestium pieces/cutting workflow.
-- Existing records are retained and mapped to the nearest new state.

CREATE TYPE "RequisitionStatus_new" AS ENUM (
  'DRAFT', 'REQUESTED', 'IN_REVIEW', 'WAITING_MATERIAL', 'RELEASED',
  'IN_CUTTING', 'INSPECTION', 'COMPLETED', 'CANCELLED'
);

ALTER TABLE "Requisition" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Requisition" ALTER COLUMN "status" TYPE "RequisitionStatus_new"
USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'REQUESTED'
    WHEN 'IN_REVIEW' THEN 'IN_REVIEW'
    WHEN 'APPROVED' THEN 'RELEASED'
    WHEN 'SEPARATION' THEN 'IN_CUTTING'
    WHEN 'CONCLUDED' THEN 'COMPLETED'
    WHEN 'REFUSED' THEN 'CANCELLED'
    ELSE 'CANCELLED'
  END
)::"RequisitionStatus_new";
DROP TYPE "RequisitionStatus";
ALTER TYPE "RequisitionStatus_new" RENAME TO "RequisitionStatus";
ALTER TABLE "Requisition" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE TYPE "RequisitionItemStatus_new" AS ENUM ('PENDING', 'CUTTING', 'CUT', 'INSPECTED');
ALTER TABLE "RequisitionItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RequisitionItem" ALTER COLUMN "status" TYPE "RequisitionItemStatus_new"
USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING'
    WHEN 'SEPARATED' THEN 'CUT'
    WHEN 'CONCLUDED' THEN 'INSPECTED'
    ELSE 'PENDING'
  END
)::"RequisitionItemStatus_new";
DROP TYPE "RequisitionItemStatus";
ALTER TYPE "RequisitionItemStatus_new" RENAME TO "RequisitionItemStatus";
ALTER TABLE "RequisitionItem" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE TYPE "RequisitionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "InspectionResult" AS ENUM ('APPROVED', 'NEEDS_CORRECTION');

ALTER TABLE "Requisition"
  ADD COLUMN "priority" "RequisitionPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "clientName" TEXT,
  ADD COLUMN "projectReference" TEXT,
  ADD COLUMN "neededAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "cuttingStartedAt" TIMESTAMP(3),
  ADD COLUMN "inspectedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "inspectionResult" "InspectionResult",
  ADD COLUMN "inspectionNote" TEXT,
  ADD COLUMN "responsibleId" TEXT,
  ADD COLUMN "cutterId" TEXT,
  ADD COLUMN "inspectorId" TEXT;

ALTER TABLE "RequisitionItem"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "material" TEXT,
  ADD COLUMN "thickness" DECIMAL(10,2),
  ADD COLUMN "length" DECIMAL(10,2),
  ADD COLUMN "width" DECIMAL(10,2),
  ADD COLUMN "unit" "Unit" NOT NULL DEFAULT 'UNIT',
  ADD COLUMN "edgeFinish" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "RequisitionItem" ri
SET "description" = COALESCE(p."name", 'Peça sem descrição'),
    "unit" = COALESCE(p."unit", 'UNIT')
FROM "Product" p
WHERE p."id" = ri."productId";
UPDATE "RequisitionItem" SET "description" = 'Peça sem descrição' WHERE "description" IS NULL;
ALTER TABLE "RequisitionItem" ALTER COLUMN "description" SET NOT NULL;
ALTER TABLE "RequisitionItem" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "RequisitionItem" DROP CONSTRAINT IF EXISTS "RequisitionItem_productId_fkey";
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX IF EXISTS "RequisitionItem_requisitionId_productId_key";

ALTER TABLE "StockReservation"
  ADD COLUMN "requisitionId" TEXT,
  ADD COLUMN "requisitionItemId" TEXT;

CREATE TABLE "RequisitionHistory" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromValue" JSONB,
  "toValue" JSONB,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requisitionId" TEXT NOT NULL,
  "userId" TEXT,
  CONSTRAINT "RequisitionHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RequisitionAttachment" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requisitionId" TEXT NOT NULL,
  CONSTRAINT "RequisitionAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_cutterId_fkey" FOREIGN KEY ("cutterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_requisitionItemId_fkey" FOREIGN KEY ("requisitionItemId") REFERENCES "RequisitionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequisitionHistory" ADD CONSTRAINT "RequisitionHistory_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequisitionHistory" ADD CONSTRAINT "RequisitionHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RequisitionAttachment" ADD CONSTRAINT "RequisitionAttachment_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Requisition_priority_idx" ON "Requisition"("priority");
CREATE INDEX "Requisition_neededAt_idx" ON "Requisition"("neededAt");
CREATE INDEX "Requisition_requesterId_idx" ON "Requisition"("requesterId");
CREATE INDEX "Requisition_responsibleId_idx" ON "Requisition"("responsibleId");
CREATE INDEX "RequisitionItem_requisitionId_idx" ON "RequisitionItem"("requisitionId");
CREATE INDEX "RequisitionItem_productId_idx" ON "RequisitionItem"("productId");
CREATE INDEX "StockReservation_requisitionId_status_idx" ON "StockReservation"("requisitionId", "status");
CREATE INDEX "StockReservation_requisitionItemId_status_idx" ON "StockReservation"("requisitionItemId", "status");
CREATE INDEX "RequisitionHistory_requisitionId_createdAt_idx" ON "RequisitionHistory"("requisitionId", "createdAt");
CREATE INDEX "RequisitionAttachment_requisitionId_idx" ON "RequisitionAttachment"("requisitionId");

-- Existing live requests were already submitted in the legacy flow.
UPDATE "Requisition" SET "submittedAt" = "createdAt" WHERE "status" <> 'DRAFT';
UPDATE "Requisition" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED';
UPDATE "Requisition" SET "cancelledAt" = "updatedAt" WHERE "status" = 'CANCELLED';

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_req_read_all', 'requisitions.read.all', 'Ver requisições de todos', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_edit', 'requisitions.edit', 'Editar próprios rascunhos', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_edit_all', 'requisitions.edit.all', 'Editar todos os rascunhos', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_analyze', 'requisitions.analyze', 'Analisar requisições', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_reserve', 'requisitions.reserve', 'Reservar materiais', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_release', 'requisitions.release', 'Liberar para corte', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_cut', 'requisitions.cut', 'Executar corte', 'Requisições', CURRENT_TIMESTAMP),
  ('perm_req_inspect', 'requisitions.inspect', 'Conferir e concluir', 'Requisições', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE (r."name" = 'ADMIN' AND p."code" LIKE 'requisitions.%')
   OR (r."name" = 'MANAGER' AND p."code" IN ('requisitions.read.all','requisitions.edit.all','requisitions.analyze','requisitions.reserve','requisitions.release','requisitions.cut','requisitions.inspect'))
   OR (r."name" = 'WAREHOUSE' AND p."code" IN ('requisitions.read.all','requisitions.reserve'))
   OR (r."name" = 'REQUESTER' AND p."code" = 'requisitions.edit')
ON CONFLICT DO NOTHING;

INSERT INTO "Role" ("id", "name", "label", "description", "createdAt")
VALUES ('role_production', 'PRODUCTION', 'Produção / Corte', 'Executa e confere as peças liberadas para produção', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'PRODUCTION' AND p."code" IN ('dashboard.read','products.read','stock.read','requisitions.read','requisitions.read.all','requisitions.cut','requisitions.inspect','notifications.read')
ON CONFLICT DO NOTHING;
