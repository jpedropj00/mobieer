-- CreateEnum
CREATE TYPE "ProjectDocumentType" AS ENUM ('MANUAL_GARANTIA', 'VISTORIA_CHECKLIST', 'CRONOGRAMA', 'VISTORIA_FOTOGRAFICA', 'CONTRATO', 'PROJETO_3D', 'OUTRO');

-- CreateEnum
CREATE TYPE "ClientAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AssistanceOrigin" AS ENUM ('INTERNAL', 'CLIENT_PORTAL');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "feedbackFormUrl" TEXT;

-- AlterTable
ALTER TABLE "AssistanceTicket"
    ALTER COLUMN "createdById" DROP NOT NULL,
    ADD COLUMN "openedByClientAccountId" TEXT,
    ADD COLUMN "origin" "AssistanceOrigin" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ProjectDocumentType" NOT NULL DEFAULT 'OUTRO',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "visibleToClient" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "replacesId" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "ClientAccountStatus" NOT NULL DEFAULT 'INVITED',
    "inviteToken" TEXT,
    "inviteExpiry" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "lastLogin" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDocument_organizationId_projectId_type_idx" ON "ProjectDocument"("organizationId", "projectId", "type");

-- CreateIndex
CREATE INDEX "ProjectDocument_clientId_visibleToClient_idx" ON "ProjectDocument"("clientId", "visibleToClient");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_email_key" ON "ClientAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_inviteToken_key" ON "ClientAccount"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_resetToken_key" ON "ClientAccount"("resetToken");

-- CreateIndex
CREATE INDEX "ClientAccount_clientId_idx" ON "ClientAccount"("clientId");

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AssistanceTicket_openedByClientAccountId_idx" ON "AssistanceTicket"("openedByClientAccountId");

-- AddForeignKey
ALTER TABLE "AssistanceTicket" ADD CONSTRAINT "AssistanceTicket_openedByClientAccountId_fkey" FOREIGN KEY ("openedByClientAccountId") REFERENCES "ClientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
