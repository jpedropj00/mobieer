CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ActivityProblemPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "ActivityAttachmentKind" AS ENUM ('PHOTO', 'FILE', 'PROBLEM_PHOTO');
CREATE TYPE "ActivitySignatureRole" AS ENUM ('EMPLOYEE', 'CLIENT', 'INSPECTOR');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
INSERT INTO "Organization" ("id", "name") VALUES ('default-org', 'Gestium') ON CONFLICT DO NOTHING;

ALTER TABLE "User" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default-org';
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Activity" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT',
  "date" DATE NOT NULL, "startTime" TEXT, "endTime" TEXT, "sector" TEXT, "clientName" TEXT,
  "projectReference" TEXT, "service" TEXT NOT NULL, "description" TEXT NOT NULL,
  "problemsSummary" TEXT, "observations" TEXT, "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "organizationId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, "agendaEventId" TEXT, "taskId" TEXT, "assistanceId" TEXT,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Activity_number_key" ON "Activity"("number");
CREATE INDEX "Activity_organizationId_date_idx" ON "Activity"("organizationId", "date");
CREATE INDEX "Activity_organizationId_status_date_idx" ON "Activity"("organizationId", "status", "date");
CREATE INDEX "Activity_employeeId_date_idx" ON "Activity"("employeeId", "date");
CREATE INDEX "Activity_sector_idx" ON "Activity"("sector");
CREATE INDEX "Activity_clientName_idx" ON "Activity"("clientName");
CREATE INDEX "Activity_projectReference_idx" ON "Activity"("projectReference");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ActivityMaterial" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL, "unit" "Unit" NOT NULL,
  "note" TEXT, "stockMovementId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activityId" TEXT NOT NULL, "productId" TEXT, CONSTRAINT "ActivityMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityMaterial_activityId_idx" ON "ActivityMaterial"("activityId");
CREATE INDEX "ActivityMaterial_productId_idx" ON "ActivityMaterial"("productId");
CREATE INDEX "ActivityMaterial_stockMovementId_idx" ON "ActivityMaterial"("stockMovementId");
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ActivityProblem" (
  "id" TEXT NOT NULL, "description" TEXT NOT NULL, "note" TEXT, "priority" "ActivityProblemPriority" NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "activityId" TEXT NOT NULL,
  CONSTRAINT "ActivityProblem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityProblem_activityId_idx" ON "ActivityProblem"("activityId");
ALTER TABLE "ActivityProblem" ADD CONSTRAINT "ActivityProblem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActivityAttachment" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "url" TEXT NOT NULL, "mimeType" TEXT, "size" INTEGER,
  "kind" "ActivityAttachmentKind" NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activityId" TEXT NOT NULL, "problemId" TEXT, CONSTRAINT "ActivityAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityAttachment_activityId_idx" ON "ActivityAttachment"("activityId");
CREATE INDEX "ActivityAttachment_problemId_idx" ON "ActivityAttachment"("problemId");
ALTER TABLE "ActivityAttachment" ADD CONSTRAINT "ActivityAttachment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityAttachment" ADD CONSTRAINT "ActivityAttachment_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "ActivityProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActivitySignature" (
  "id" TEXT NOT NULL, "role" "ActivitySignatureRole" NOT NULL, "signerName" TEXT NOT NULL, "dataUrl" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "activityId" TEXT NOT NULL, "signedById" TEXT,
  CONSTRAINT "ActivitySignature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActivitySignature_activityId_role_key" ON "ActivitySignature"("activityId", "role");
CREATE INDEX "ActivitySignature_signedById_idx" ON "ActivitySignature"("signedById");
ALTER TABLE "ActivitySignature" ADD CONSTRAINT "ActivitySignature_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivitySignature" ADD CONSTRAINT "ActivitySignature_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ActivityHistory" (
  "id" TEXT NOT NULL, "action" TEXT NOT NULL, "details" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activityId" TEXT NOT NULL, "userId" TEXT, CONSTRAINT "ActivityHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityHistory_activityId_createdAt_idx" ON "ActivityHistory"("activityId", "createdAt");
CREATE INDEX "ActivityHistory_userId_idx" ON "ActivityHistory"("userId");
ALTER TABLE "ActivityHistory" ADD CONSTRAINT "ActivityHistory_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityHistory" ADD CONSTRAINT "ActivityHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityMaterial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityProblem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivitySignature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
 ('perm_act_read','activities.read','Ver atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_read_all','activities.read.all','Ver atividades da equipe','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_create','activities.create','Criar atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_edit','activities.edit','Editar próprias atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_edit_all','activities.edit.all','Editar atividades da equipe','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_complete','activities.complete','Concluir atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_cancel','activities.cancel','Cancelar atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_delete','activities.delete','Excluir rascunhos','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_export','activities.export','Exportar atividades','Atividades',CURRENT_TIMESTAMP),
 ('perm_act_sign','activities.sign','Assinar atividades','Atividades',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE (r."name" IN ('ADMIN','MANAGER') AND p."code" LIKE 'activities.%')
   OR (r."name" IN ('WAREHOUSE','PRODUCTION','REQUESTER') AND p."code" IN ('activities.read','activities.create','activities.edit','activities.complete','activities.cancel','activities.export','activities.sign'))
   OR (r."name" = 'VIEWER' AND p."code" = 'activities.read')
ON CONFLICT DO NOTHING;
