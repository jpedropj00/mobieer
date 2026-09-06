-- CreateEnum
CREATE TYPE "MeasurementStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "MeasurementVisit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "MeasurementStatus" NOT NULL DEFAULT 'REQUESTED',
    "preferredDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredPeriod" TEXT,
    "clientNotes" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "technicianId" TEXT,
    "teamNotes" TEXT,
    "doneAt" TIMESTAMP(3),
    "techProjectDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeasurementVisit_organizationId_status_idx" ON "MeasurementVisit"("organizationId", "status");
CREATE INDEX "MeasurementVisit_projectId_idx" ON "MeasurementVisit"("projectId");

-- AddForeignKey
ALTER TABLE "MeasurementVisit" ADD CONSTRAINT "MeasurementVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeasurementVisit" ADD CONSTRAINT "MeasurementVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeasurementVisit" ADD CONSTRAINT "MeasurementVisit_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
