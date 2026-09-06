-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRECO', 'PRAZO', 'CONCORRENCIA', 'SEM_RESPOSTA', 'DESISTIU', 'ESCOPO', 'OUTRO');

-- AlterTable
ALTER TABLE "CommercialOpportunity" ADD COLUMN "lostReasonCode" "LostReason";

-- AlterTable
ALTER TABLE "FinanceTransaction"
    ADD COLUMN "installmentGroup" TEXT,
    ADD COLUMN "installmentNumber" INTEGER,
    ADD COLUMN "installmentTotal" INTEGER,
    ADD COLUMN "originOpportunityId" TEXT,
    ADD COLUMN "cardExpenseId" TEXT;

-- CreateTable
CREATE TABLE "CreditCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastDigits" TEXT,
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "referenceMonth" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fileKey" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardExpense" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "installment" TEXT,

    CONSTRAINT "CardExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceTransaction_installmentGroup_idx" ON "FinanceTransaction"("installmentGroup");
CREATE UNIQUE INDEX "FinanceTransaction_cardExpenseId_key" ON "FinanceTransaction"("cardExpenseId");
CREATE INDEX "CreditCard_organizationId_active_idx" ON "CreditCard"("organizationId", "active");
CREATE INDEX "CardStatement_organizationId_referenceMonth_idx" ON "CardStatement"("organizationId", "referenceMonth");
CREATE UNIQUE INDEX "CardStatement_cardId_referenceMonth_key" ON "CardStatement"("cardId", "referenceMonth");
CREATE INDEX "CardExpense_statementId_idx" ON "CardExpense"("statementId");
CREATE INDEX "CardExpense_category_idx" ON "CardExpense"("category");

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_originOpportunityId_fkey" FOREIGN KEY ("originOpportunityId") REFERENCES "CommercialOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_cardExpenseId_fkey" FOREIGN KEY ("cardExpenseId") REFERENCES "CardExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardExpense" ADD CONSTRAINT "CardExpense_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
