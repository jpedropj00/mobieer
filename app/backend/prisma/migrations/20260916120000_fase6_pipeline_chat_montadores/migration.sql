-- ============================================================
-- FASE 6 — Pipeline da loja, assistência agendada pelo cliente,
-- automações de WhatsApp, chat, montadores com login, tempo por
-- cômodo com meta própria, bonificação e integração Promob.
--
-- Gerado por `prisma migrate diff` e LIMPO à mão: o diff também trazia drift
-- antigo (índices/defaults que existem no banco e não no schema). Esse drift
-- ficou de fora de propósito — não pertence a esta fase.
-- ============================================================

-- CreateEnum
CREATE TYPE "MessageEvent" AS ENUM ('CLIENT_WELCOME', 'LEAD_RECEIVED', 'PORTAL_ACCESS', 'MEASUREMENT_SCHEDULED', 'TECH_APPROVAL_READY', 'PRODUCTION_STAGE', 'ASSISTANCE_RECEIVED', 'ASSISTANCE_OPTIONS', 'ASSISTANCE_SCHEDULED', 'ASSISTANCE_REMINDER', 'POST_SALE_FOLLOWUP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'LOGGED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('TEAM', 'CONTRACTORS', 'GROUP', 'DIRECT');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('COZINHA', 'BANHEIRO', 'LAVABO', 'DORMITORIO', 'CLOSET', 'SALA', 'HOME_OFFICE', 'LAVANDERIA', 'AREA_GOURMET', 'VARANDA', 'CORREDOR', 'OUTRO');

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallationReview" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BonusStatus" AS ENUM ('APPROVED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "AssistanceTicket" ADD COLUMN     "clientConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmToken" TEXT,
ADD COLUMN     "optionsSentAt" TIMESTAMP(3),
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestedAt" TIMESTAMP(3),
ADD COLUMN     "schedulePeriod" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contractor" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "PromobImport" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "AssistanceVisitOption" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "period" TEXT,
    "chosenAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistanceVisitOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAutomation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" "MessageEvent" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "metaTemplateName" TEXT,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "event" "MessageEvent" NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "to" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "providerMessageId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL,
    "name" TEXT,
    "directKey" TEXT,
    "createdById" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "roomLabel" TEXT,
    "status" "InstallationStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "targetMinutes" INTEGER,
    "review" "InstallationReview" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallationTaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,

    CONSTRAINT "InstallationTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorBonus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "actualMinutes" INTEGER NOT NULL,
    "gainPct" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "BonusStatus" NOT NULL DEFAULT 'APPROVED',
    "paidAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minSamples" INTEGER NOT NULL DEFAULT 3,
    "tiers" JSONB NOT NULL,
    "maxPerMonth" DECIMAL(12,2),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistanceVisitOption_ticketId_idx" ON "AssistanceVisitOption"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAutomation_organizationId_event_key" ON "MessageAutomation"("organizationId", "event");

-- CreateIndex
CREATE INDEX "MessageLog_organizationId_createdAt_idx" ON "MessageLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_clientId_idx" ON "MessageLog"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_organizationId_dedupeKey_key" ON "MessageLog"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ChatChannel_organizationId_kind_idx" ON "ChatChannel"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_organizationId_directKey_key" ON "ChatChannel"("organizationId", "directKey");

-- CreateIndex
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_channelId_userId_key" ON "ChatMember"("channelId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_idx" ON "ChatMessage"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "InstallationTask_organizationId_status_idx" ON "InstallationTask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InstallationTask_contractorId_roomType_status_idx" ON "InstallationTask"("contractorId", "roomType", "status");

-- CreateIndex
CREATE INDEX "InstallationTask_projectId_idx" ON "InstallationTask"("projectId");

-- CreateIndex
CREATE INDEX "InstallationTaskLog_taskId_idx" ON "InstallationTaskLog"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorBonus_taskId_key" ON "ContractorBonus"("taskId");

-- CreateIndex
CREATE INDEX "ContractorBonus_organizationId_status_idx" ON "ContractorBonus"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ContractorBonus_contractorId_createdAt_idx" ON "ContractorBonus"("contractorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BonusPolicy_organizationId_key" ON "BonusPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationToken_tokenHash_key" ON "IntegrationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "IntegrationToken_organizationId_idx" ON "IntegrationToken"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistanceTicket_confirmToken_key" ON "AssistanceTicket"("confirmToken");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_userId_key" ON "Contractor"("userId");

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistanceVisitOption" ADD CONSTRAINT "AssistanceVisitOption_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "AssistanceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAutomation" ADD CONSTRAINT "MessageAutomation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationTask" ADD CONSTRAINT "InstallationTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationTask" ADD CONSTRAINT "InstallationTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationTask" ADD CONSTRAINT "InstallationTask_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationTaskLog" ADD CONSTRAINT "InstallationTaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "InstallationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBonus" ADD CONSTRAINT "ContractorBonus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBonus" ADD CONSTRAINT "ContractorBonus_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorBonus" ADD CONSTRAINT "ContractorBonus_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "InstallationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusPolicy" ADD CONSTRAINT "BonusPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationToken" ADD CONSTRAINT "IntegrationToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- Permissões e perfil do montador (idempotente)
-- ------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "label", "module") VALUES
  ('perm_chat_use', 'chat.use', 'Usar o chat interno', 'Chat'),
  ('perm_chat_manage', 'chat.manage', 'Criar grupos e gerenciar membros do chat', 'Chat'),
  ('perm_contractors_self', 'contractors.self', 'Área do montador (ponto, cômodos e produtividade próprios)', 'Montadores')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Role" ("id", "name", "label", "description") VALUES
  ('role_montador', 'MONTADOR', 'Montador terceirizado', 'Acesso do montador: registra ponto e cômodos, vê a própria produtividade e usa o chat')
ON CONFLICT ("name") DO NOTHING;

-- chat.use para todos os perfis existentes; chat.manage para gestão/RH/admin
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'chat.use'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE p."code" = 'chat.manage' AND r."name" IN ('ADMIN', 'MANAGER', 'RH')
ON CONFLICT DO NOTHING;

-- ADMIN recebe tudo que é novo
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'ADMIN' AND p."code" IN ('contractors.self')
ON CONFLICT DO NOTHING;

-- MONTADOR: só a própria área, chat e notificações
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'MONTADOR' AND p."code" IN ('contractors.self', 'chat.use', 'notifications.read')
ON CONFLICT DO NOTHING;
