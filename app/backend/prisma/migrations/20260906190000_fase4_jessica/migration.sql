-- CreateEnum
CREATE TYPE "HourBankKind" AS ENUM ('ADJUSTMENT', 'COMPENSATION', 'PAYOUT');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "freeText" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AssistanceAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByClientAccountId" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistanceAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "color" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "weekday" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourBankAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" "HourBankKind" NOT NULL DEFAULT 'ADJUSTMENT',
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourBankAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistanceAttachment_ticketId_idx" ON "AssistanceAttachment"("ticketId");
CREATE INDEX "WorkspaceNote_userId_pinned_position_idx" ON "WorkspaceNote"("userId", "pinned", "position");
CREATE INDEX "PlannerItem_userId_weekOf_idx" ON "PlannerItem"("userId", "weekOf");
CREATE INDEX "HourBankAdjustment_employeeId_date_idx" ON "HourBankAdjustment"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "AssistanceAttachment" ADD CONSTRAINT "AssistanceAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "AssistanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceNote" ADD CONSTRAINT "WorkspaceNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceNote" ADD CONSTRAINT "WorkspaceNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannerItem" ADD CONSTRAINT "PlannerItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlannerItem" ADD CONSTRAINT "PlannerItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HourBankAdjustment" ADD CONSTRAINT "HourBankAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HourBankAdjustment" ADD CONSTRAINT "HourBankAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HourBankAdjustment" ADD CONSTRAINT "HourBankAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
