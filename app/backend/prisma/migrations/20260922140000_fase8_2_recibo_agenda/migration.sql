-- Fase 8.2: recibo gerado após o pagamento, comprovante enviado pelo cliente,
-- lembretes de parcela e resposta do convidado na agenda.
-- Aditiva e idempotente.

-- Agenda: o convidado aceita, recusa ou pede para remarcar
DO $$ BEGIN
  CREATE TYPE "AgendaResponse" AS ENUM ('PENDENTE', 'ACEITO', 'RECUSADO', 'REMARCAR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "AgendaParticipant"
  ADD COLUMN IF NOT EXISTS "response" "AgendaResponse" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS "respondedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "responseNote" TEXT,
  ADD COLUMN IF NOT EXISTS "proposedStart" TIMESTAMP(3);

-- Quem já estava convidado antes desta fase não tinha como responder: conta
-- como aceito, para não aparecer uma lista enorme de "pendente" do nada.
UPDATE "AgendaParticipant" SET "response" = 'ACEITO', "respondedAt" = "createdAt"
WHERE "response" = 'PENDENTE' AND "respondedAt" IS NULL AND "createdAt" < CURRENT_TIMESTAMP;

-- Pagamento: recibo em PDF gerado pelo sistema
ALTER TABLE "FinancePayment" ADD COLUMN IF NOT EXISTS "receiptDocumentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "FinancePayment_receiptDocumentId_key" ON "FinancePayment"("receiptDocumentId");
DO $$ BEGIN
  ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_receiptDocumentId_fkey"
    FOREIGN KEY ("receiptDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Comprovante enviado pelo cliente no portal, aguardando conferência do financeiro
ALTER TABLE "FinanceAttachment"
  ADD COLUMN IF NOT EXISTS "uploadedByClientAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
CREATE INDEX IF NOT EXISTS "FinanceAttachment_pending_client_idx"
  ON "FinanceAttachment"("transactionId") WHERE "uploadedByClientAccountId" IS NOT NULL AND "reviewedAt" IS NULL;

-- Documento gerado: de onde veio e com qual versão de modelo
ALTER TABLE "ProjectDocument"
  ADD COLUMN IF NOT EXISTS "generatedFrom" TEXT,
  ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER;

-- Mensagens ao cliente sobre as parcelas
ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'PAYMENT_REMINDER';
ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'PAYMENT_DUE_TODAY';
ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'PAYMENT_OVERDUE';
ALTER TYPE "MessageEvent" ADD VALUE IF NOT EXISTS 'RECEIPT_AVAILABLE';

-- Agenda ligada ao cadastro central. clientName/projectReference continuam
-- (compromisso com quem ainda não é cliente cadastrado).
ALTER TABLE "AgendaEvent"
  ADD COLUMN IF NOT EXISTS "clientId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;
DO $$ BEGIN
  ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgendaEvent" ADD CONSTRAINT "AgendaEvent_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "AgendaEvent_clientId_idx" ON "AgendaEvent"("clientId");
CREATE INDEX IF NOT EXISTS "AgendaEvent_projectId_idx" ON "AgendaEvent"("projectId");

-- Backfill conservador: só liga quando o texto é exatamente o código de um
-- projeto da mesma organização. Nome parecido não é ligado — errar o cliente
-- de um compromisso é pior do que deixar sem vínculo.
UPDATE "AgendaEvent" e
SET "projectId" = p."id", "clientId" = p."clientId"
FROM "Project" p
WHERE e."projectId" IS NULL
  AND e."projectReference" IS NOT NULL
  AND p."organizationId" = e."organizationId"
  AND upper(trim(e."projectReference")) = upper(p."code");
