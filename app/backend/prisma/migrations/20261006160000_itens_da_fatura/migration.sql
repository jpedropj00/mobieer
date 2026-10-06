-- Fatura de cartão lida do PDF: cada compra (data, loja, valor) vira uma linha
-- do documento financeiro. O documento continua sendo uma conta só, pelo total.
CREATE TABLE IF NOT EXISTS "FinanceDocumentItem" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "date" TIMESTAMP(3),
  "store" TEXT NOT NULL,
  "description" TEXT,
  "installment" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceDocumentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceDocumentItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FinanceDocumentItem_transactionId_idx" ON "FinanceDocumentItem"("transactionId");
