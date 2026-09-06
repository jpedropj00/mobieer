-- CreateEnum
CREATE TYPE "TechApprovalStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateTable
CREATE TABLE "TechnicalProjectApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "TechApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "documentId" TEXT,
    "termText" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "signatureDataUrl" TEXT,
    "signedByClientAccountId" TEXT,
    "clientComment" TEXT,
    "reviewRound" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicalProjectApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalProjectApproval_projectId_key" ON "TechnicalProjectApproval"("projectId");
CREATE INDEX "TechnicalProjectApproval_organizationId_status_idx" ON "TechnicalProjectApproval"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "TechnicalProjectApproval" ADD CONSTRAINT "TechnicalProjectApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicalProjectApproval" ADD CONSTRAINT "TechnicalProjectApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicalProjectApproval" ADD CONSTRAINT "TechnicalProjectApproval_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TechnicalProjectApproval" ADD CONSTRAINT "TechnicalProjectApproval_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
