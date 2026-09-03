-- CreateEnum
CREATE TYPE "CommercialLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'NEGOTIATION', 'WAITING_CLIENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CommercialInteractionType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'VISIT', 'INTERNAL_MESSAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'NEGOTIATION', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('CREATED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'RELEASED', 'PAID');

-- CreateEnum
CREATE TYPE "PostSaleStatus" AS ENUM ('PENDING', 'CONTACTED', 'COMPLETED', 'NEEDS_ASSISTANCE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "primaryContact" TEXT,
ADD COLUMN     "sellerId" TEXT;

-- AlterTable
ALTER TABLE "KanbanTask" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "salesOrderId" TEXT;

-- CreateTable
CREATE TABLE "SalesStage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "SalesStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "interest" TEXT,
    "status" "CommercialLeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastContactAt" TIMESTAMP(3),
    "nextContactAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sellerId" TEXT,
    "convertedClientId" TEXT,

    CONSTRAINT "CommercialLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialOpportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "estimatedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseAt" TIMESTAMP(3),
    "source" TEXT,
    "notes" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "clientId" TEXT,
    "leadId" TEXT,
    "sellerId" TEXT NOT NULL,

    CONSTRAINT "CommercialOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialInteraction" (
    "id" TEXT NOT NULL,
    "type" "CommercialInteractionType" NOT NULL,
    "summary" TEXT NOT NULL,
    "result" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "responsibleId" TEXT NOT NULL,
    "agendaEventId" TEXT,

    CONSTRAINT "CommercialInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialQuote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "sellerId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "CommercialQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialQuoteItem" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT,

    CONSTRAINT "CommercialQuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialProposal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "presentation" TEXT,
    "scope" TEXT,
    "terms" TEXT,
    "deadlines" TEXT,
    "notes" TEXT,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "quoteId" TEXT,
    "sellerId" TEXT NOT NULL,

    CONSTRAINT "CommercialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialProposalAttachment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "proposalId" TEXT NOT NULL,

    CONSTRAINT "CommercialProposalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'CREATED',
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "quoteId" TEXT,
    "opportunityId" TEXT,
    "sellerId" TEXT NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DECIMAL(14,2) NOT NULL,
    "origin" TEXT,
    "financialStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCommission" (
    "id" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "percentage" DECIMAL(7,4),
    "fixedAmount" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "saleId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,

    CONSTRAINT "SalesCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSale" (
    "id" TEXT NOT NULL,
    "status" "PostSaleStatus" NOT NULL DEFAULT 'PENDING',
    "contactDueAt" TIMESTAMP(3) NOT NULL,
    "contactedAt" TIMESTAMP(3),
    "result" TEXT,
    "notes" TEXT,
    "satisfaction" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "orderId" TEXT,
    "saleId" TEXT,
    "projectId" TEXT,
    "responsibleId" TEXT NOT NULL,

    CONSTRAINT "PostSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialHistory" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromValue" JSONB,
    "toValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "quoteId" TEXT,
    "userId" TEXT,

    CONSTRAINT "CommercialHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesStage_organizationId_position_key" ON "SalesStage"("organizationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStage_organizationId_name_key" ON "SalesStage"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CommercialLead_organizationId_status_enteredAt_idx" ON "CommercialLead"("organizationId", "status", "enteredAt");

-- CreateIndex
CREATE INDEX "CommercialLead_sellerId_nextContactAt_idx" ON "CommercialLead"("sellerId", "nextContactAt");

-- CreateIndex
CREATE INDEX "CommercialLead_convertedClientId_idx" ON "CommercialLead"("convertedClientId");

-- CreateIndex
CREATE INDEX "CommercialOpportunity_organizationId_status_expectedCloseAt_idx" ON "CommercialOpportunity"("organizationId", "status", "expectedCloseAt");

-- CreateIndex
CREATE INDEX "CommercialOpportunity_stageId_position_idx" ON "CommercialOpportunity"("stageId", "position");

-- CreateIndex
CREATE INDEX "CommercialOpportunity_sellerId_idx" ON "CommercialOpportunity"("sellerId");

-- CreateIndex
CREATE INDEX "CommercialOpportunity_clientId_idx" ON "CommercialOpportunity"("clientId");

-- CreateIndex
CREATE INDEX "CommercialOpportunity_leadId_idx" ON "CommercialOpportunity"("leadId");

-- CreateIndex
CREATE INDEX "CommercialInteraction_clientId_occurredAt_idx" ON "CommercialInteraction"("clientId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommercialInteraction_leadId_occurredAt_idx" ON "CommercialInteraction"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommercialInteraction_responsibleId_nextActionAt_idx" ON "CommercialInteraction"("responsibleId", "nextActionAt");

-- CreateIndex
CREATE INDEX "CommercialQuote_organizationId_status_issuedAt_idx" ON "CommercialQuote"("organizationId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "CommercialQuote_clientId_idx" ON "CommercialQuote"("clientId");

-- CreateIndex
CREATE INDEX "CommercialQuote_sellerId_idx" ON "CommercialQuote"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialQuote_organizationId_number_version_key" ON "CommercialQuote"("organizationId", "number", "version");

-- CreateIndex
CREATE INDEX "CommercialQuoteItem_quoteId_idx" ON "CommercialQuoteItem"("quoteId");

-- CreateIndex
CREATE INDEX "CommercialQuoteItem_productId_idx" ON "CommercialQuoteItem"("productId");

-- CreateIndex
CREATE INDEX "CommercialProposal_organizationId_status_idx" ON "CommercialProposal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CommercialProposal_clientId_idx" ON "CommercialProposal"("clientId");

-- CreateIndex
CREATE INDEX "CommercialProposalAttachment_proposalId_idx" ON "CommercialProposalAttachment"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_status_orderedAt_idx" ON "SalesOrder"("organizationId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "SalesOrder_clientId_idx" ON "SalesOrder"("clientId");

-- CreateIndex
CREATE INDEX "SalesOrder_sellerId_idx" ON "SalesOrder"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_number_key" ON "SalesOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "SalesOrderItem_orderId_idx" ON "SalesOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_orderId_key" ON "Sale"("orderId");

-- CreateIndex
CREATE INDEX "Sale_organizationId_soldAt_idx" ON "Sale"("organizationId", "soldAt");

-- CreateIndex
CREATE INDEX "Sale_sellerId_idx" ON "Sale"("sellerId");

-- CreateIndex
CREATE INDEX "Sale_clientId_idx" ON "Sale"("clientId");

-- CreateIndex
CREATE INDEX "SalesCommission_sellerId_status_idx" ON "SalesCommission"("sellerId", "status");

-- CreateIndex
CREATE INDEX "SalesCommission_saleId_idx" ON "SalesCommission"("saleId");

-- CreateIndex
CREATE INDEX "PostSale_organizationId_status_contactDueAt_idx" ON "PostSale"("organizationId", "status", "contactDueAt");

-- CreateIndex
CREATE INDEX "PostSale_clientId_idx" ON "PostSale"("clientId");

-- CreateIndex
CREATE INDEX "PostSale_responsibleId_idx" ON "PostSale"("responsibleId");

-- CreateIndex
CREATE INDEX "CommercialHistory_clientId_createdAt_idx" ON "CommercialHistory"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialHistory_leadId_createdAt_idx" ON "CommercialHistory"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialHistory_opportunityId_createdAt_idx" ON "CommercialHistory"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialHistory_quoteId_createdAt_idx" ON "CommercialHistory"("quoteId", "createdAt");

-- CreateIndex
CREATE INDEX "Client_sellerId_idx" ON "Client"("sellerId");

-- CreateIndex
CREATE INDEX "KanbanTask_leadId_idx" ON "KanbanTask"("leadId");

-- CreateIndex
CREATE INDEX "KanbanTask_opportunityId_idx" ON "KanbanTask"("opportunityId");

-- CreateIndex
CREATE INDEX "KanbanTask_quoteId_idx" ON "KanbanTask"("quoteId");

-- CreateIndex
CREATE INDEX "KanbanTask_salesOrderId_idx" ON "KanbanTask"("salesOrderId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTask" ADD CONSTRAINT "KanbanTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTask" ADD CONSTRAINT "KanbanTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTask" ADD CONSTRAINT "KanbanTask_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KanbanTask" ADD CONSTRAINT "KanbanTask_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesStage" ADD CONSTRAINT "SalesStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLead" ADD CONSTRAINT "CommercialLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLead" ADD CONSTRAINT "CommercialLead_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLead" ADD CONSTRAINT "CommercialLead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOpportunity" ADD CONSTRAINT "CommercialOpportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOpportunity" ADD CONSTRAINT "CommercialOpportunity_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "SalesStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOpportunity" ADD CONSTRAINT "CommercialOpportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOpportunity" ADD CONSTRAINT "CommercialOpportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOpportunity" ADD CONSTRAINT "CommercialOpportunity_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInteraction" ADD CONSTRAINT "CommercialInteraction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInteraction" ADD CONSTRAINT "CommercialInteraction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInteraction" ADD CONSTRAINT "CommercialInteraction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInteraction" ADD CONSTRAINT "CommercialInteraction_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialInteraction" ADD CONSTRAINT "CommercialInteraction_agendaEventId_fkey" FOREIGN KEY ("agendaEventId") REFERENCES "AgendaEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuote" ADD CONSTRAINT "CommercialQuote_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommercialQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuoteItem" ADD CONSTRAINT "CommercialQuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialQuoteItem" ADD CONSTRAINT "CommercialQuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposalAttachment" ADD CONSTRAINT "CommercialProposalAttachment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCommission" ADD CONSTRAINT "SalesCommission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCommission" ADD CONSTRAINT "SalesCommission_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSale" ADD CONSTRAINT "PostSale_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialHistory" ADD CONSTRAINT "CommercialHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialHistory" ADD CONSTRAINT "CommercialHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialHistory" ADD CONSTRAINT "CommercialHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialHistory" ADD CONSTRAINT "CommercialHistory_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "CommercialQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialHistory" ADD CONSTRAINT "CommercialHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-new','Novo Lead',0,10,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-contact','Primeiro Contato',1,20,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-qualified','Qualificação',2,40,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-quote','Orçamento',3,60,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-negotiation','Negociação',4,75,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-waiting','Aguardando Cliente',5,80,false,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-won','Fechado Ganho',6,100,true,false,o."id" FROM "Organization" o;
INSERT INTO "SalesStage" ("id","name","position","probability","isWon","isLost","organizationId") SELECT 'stage-' || o."id" || '-lost','Fechado Perdido',7,0,false,true,o."id" FROM "Organization" o;

INSERT INTO "Permission" ("id","code","label","module","createdAt") VALUES
('perm_com_read','commercial.read','Acessar módulo comercial','Comercial',CURRENT_TIMESTAMP),
('perm_com_read_all','commercial.read.all','Ver carteira de toda a equipe','Comercial',CURRENT_TIMESTAMP),
('perm_com_manage','commercial.manage','Gerenciar funil e equipe comercial','Comercial',CURRENT_TIMESTAMP),
('perm_com_leads','commercial.leads.manage','Gerenciar leads e contatos','Comercial',CURRENT_TIMESTAMP),
('perm_com_quotes','commercial.quotes.manage','Gerenciar orçamentos e propostas','Comercial',CURRENT_TIMESTAMP),
('perm_com_orders','commercial.orders.manage','Gerenciar pedidos e vendas','Comercial',CURRENT_TIMESTAMP),
('perm_com_commissions','commercial.commissions.manage','Gerenciar comissões','Comercial',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r."id",p."id" FROM "Role" r CROSS JOIN "Permission" p WHERE (r."name" IN ('ADMIN','MANAGER') AND p."code" LIKE 'commercial.%') ON CONFLICT DO NOTHING;
