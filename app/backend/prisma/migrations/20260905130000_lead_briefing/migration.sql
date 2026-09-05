-- CreateEnum
CREATE TYPE "BriefingOrigin" AS ENUM ('PUBLIC', 'CONSULTANT');

-- CreateTable
CREATE TABLE "LeadBriefing" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "address" TEXT,
    "investmentEstimate" DECIMAL(14,2),
    "investmentText" TEXT,
    "hasProject" BOOLEAN NOT NULL DEFAULT false,
    "environments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userCount" INTEGER,
    "discoveryChannel" TEXT,
    "notes" TEXT,
    "origin" "BriefingOrigin" NOT NULL DEFAULT 'PUBLIC',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadBriefing_leadId_key" ON "LeadBriefing"("leadId");

-- AddForeignKey
ALTER TABLE "LeadBriefing" ADD CONSTRAINT "LeadBriefing_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
