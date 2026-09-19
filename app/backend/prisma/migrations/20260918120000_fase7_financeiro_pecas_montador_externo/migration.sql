-- Fase 7: documentos financeiros com pagamento parcial, solicitação de peças do
-- montador externo, cadastro completo do montador e chat por projeto/atividade.
--
-- Migration aditiva: nenhuma coluna é removida e nenhum registro é apagado.
-- Toda coluna nova é anulável ou tem DEFAULT, então as linhas existentes
-- continuam válidas sem backfill destrutivo.

-- ===========================================================================
-- 1. Renomeação: "Montador terceirizado" -> "Montador externo"
--    Só o rótulo exibido muda. Role.name ("MONTADOR") continua igual, então
--    nenhum vínculo de usuário/permissão é perdido.
-- ===========================================================================
UPDATE "Role" SET "label" = 'Montador externo' WHERE "name" = 'MONTADOR';
UPDATE "Permission"
SET "label" = 'Área do montador externo (ponto, cômodos e produtividade próprios)',
    "module" = 'Montadores externos'
WHERE "code" = 'contractors.self';
UPDATE "Permission" SET "module" = 'Montadores externos' WHERE "module" = 'Montadores';

-- ===========================================================================
-- 2. Enums novos e valores adicionados aos existentes
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE "FinanceDocType" AS ENUM ('BOLETO', 'FATURA', 'NOTA_FISCAL', 'RECIBO', 'OUTROS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FinanceAttachmentKind" AS ENUM ('DOCUMENTO', 'COMPROVANTE', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartRequestStatus" AS ENUM (
    'RASCUNHO', 'ENVIADA', 'EM_ANALISE', 'APROVADA', 'RECUSADA', 'EM_PRODUCAO',
    'PRONTA', 'EM_TRANSPORTE', 'ENTREGUE', 'INSTALADA', 'CONCLUIDA', 'CANCELADA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartRequestPhotoKind" AS ENUM ('PECA', 'ETIQUETA', 'AMBIENTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractorDocumentType" AS ENUM ('CONTRATO', 'DOCUMENTO_PESSOAL', 'CERTIFICADO', 'COMPROVANTE', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FinanceStatus ganha PARCIAL e CANCELADO (PENDENTE e PAGO continuam intactos)
ALTER TYPE "FinanceStatus" ADD VALUE IF NOT EXISTS 'PARCIAL';
ALTER TYPE "FinanceStatus" ADD VALUE IF NOT EXISTS 'CANCELADO';

-- ChatChannelKind ganha as conversas por projeto e por atividade
ALTER TYPE "ChatChannelKind" ADD VALUE IF NOT EXISTS 'PROJECT';
ALTER TYPE "ChatChannelKind" ADD VALUE IF NOT EXISTS 'ACTIVITY';

-- NotificationType ganha os eventos da fase 7
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FINANCE_PAID';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PART_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PART_REQUEST_STATUS';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CHAT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'INSTALLATION';

-- ===========================================================================
-- 3. FinanceTransaction vira "documento financeiro"
-- ===========================================================================
ALTER TABLE "FinanceTransaction"
  ADD COLUMN IF NOT EXISTS "docType" "FinanceDocType" NOT NULL DEFAULT 'OUTROS',
  ADD COLUMN IF NOT EXISTS "docNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "issueDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "alertDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "purchaseRef" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleId" TEXT,
  ADD COLUMN IF NOT EXISTS "relatedId" TEXT;

-- Lançamentos já quitados passam a ter o valor pago preenchido, para que o
-- saldo (amount - paidAmount) nasça correto no histórico existente.
UPDATE "FinanceTransaction" SET "paidAmount" = "amount" WHERE "status" = 'PAGO' AND "paidAmount" = 0;

DO $$ BEGIN
  ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_relatedId_fkey"
    FOREIGN KEY ("relatedId") REFERENCES "FinanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "FinanceTransaction_organizationId_docType_status_idx" ON "FinanceTransaction"("organizationId", "docType", "status");
CREATE INDEX IF NOT EXISTS "FinanceTransaction_organizationId_dueDate_idx" ON "FinanceTransaction"("organizationId", "dueDate");
CREATE INDEX IF NOT EXISTS "FinanceTransaction_responsibleId_idx" ON "FinanceTransaction"("responsibleId");
CREATE INDEX IF NOT EXISTS "FinanceTransaction_relatedId_idx" ON "FinanceTransaction"("relatedId");

CREATE TABLE IF NOT EXISTS "FinancePayment" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "note" TEXT,
  "receiptKey" TEXT,
  "receiptName" TEXT,
  "receiptMime" TEXT,
  "receiptSize" INTEGER,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinancePayment_transactionId_paidAt_idx" ON "FinancePayment"("transactionId", "paidAt");
DO $$ BEGIN
  ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "FinanceAttachment" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "kind" "FinanceAttachmentKind" NOT NULL DEFAULT 'DOCUMENTO',
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinanceAttachment_transactionId_idx" ON "FinanceAttachment"("transactionId");
DO $$ BEGIN
  ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FinanceAttachment" ADD CONSTRAINT "FinanceAttachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 4. Montador externo: cadastro completo e documentos
-- ===========================================================================
ALTER TABLE "Contractor"
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "zipCode" TEXT,
  ADD COLUMN IF NOT EXISTS "pixKey" TEXT,
  ADD COLUMN IF NOT EXISTS "hiredAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ContractorDocument" (
  "id" TEXT NOT NULL,
  "contractorId" TEXT NOT NULL,
  "kind" "ContractorDocumentType" NOT NULL DEFAULT 'OUTRO',
  "title" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractorDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ContractorDocument_contractorId_idx" ON "ContractorDocument"("contractorId");
DO $$ BEGIN
  ALTER TABLE "ContractorDocument" ADD CONSTRAINT "ContractorDocument_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContractorDocument" ADD CONSTRAINT "ContractorDocument_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 5. Solicitação de peças
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "PartRequest" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" "PartRequestStatus" NOT NULL DEFAULT 'RASCUNHO',
  "priority" "RequisitionPriority" NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL,
  "roomType" "RoomType",
  "roomLabel" TEXT,
  "neededAt" TIMESTAMP(3),
  "notes" TEXT,
  "refusalReason" TEXT,
  "contractorId" TEXT,
  "projectId" TEXT,
  "activityId" TEXT,
  "createdById" TEXT NOT NULL,
  "analystId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "analyzedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "refusedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PartRequest_number_key" ON "PartRequest"("number");
CREATE INDEX IF NOT EXISTS "PartRequest_organizationId_status_idx" ON "PartRequest"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "PartRequest_contractorId_status_idx" ON "PartRequest"("contractorId", "status");
CREATE INDEX IF NOT EXISTS "PartRequest_projectId_idx" ON "PartRequest"("projectId");
CREATE INDEX IF NOT EXISTS "PartRequest_activityId_idx" ON "PartRequest"("activityId");
CREATE INDEX IF NOT EXISTS "PartRequest_neededAt_idx" ON "PartRequest"("neededAt");
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_contractorId_fkey"
    FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequest" ADD CONSTRAINT "PartRequest_analystId_fkey"
    FOREIGN KEY ("analystId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PartRequestItem" (
  "id" TEXT NOT NULL,
  "partRequestId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "width" DECIMAL(10,2),
  "height" DECIMAL(10,2),
  "depth" DECIMAL(10,2),
  "thickness" DECIMAL(10,2),
  "unit" "Unit" NOT NULL DEFAULT 'UNIT',
  "finish" TEXT,
  "color" TEXT,
  "material" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartRequestItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PartRequestItem_partRequestId_idx" ON "PartRequestItem"("partRequestId");
DO $$ BEGIN
  ALTER TABLE "PartRequestItem" ADD CONSTRAINT "PartRequestItem_partRequestId_fkey"
    FOREIGN KEY ("partRequestId") REFERENCES "PartRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PartRequestPhoto" (
  "id" TEXT NOT NULL,
  "partRequestId" TEXT NOT NULL,
  "kind" "PartRequestPhotoKind" NOT NULL DEFAULT 'PECA',
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "caption" TEXT,
  "ocrText" TEXT,
  "ocrJson" JSONB,
  "ocrConfirmedById" TEXT,
  "ocrConfirmedAt" TIMESTAMP(3),
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartRequestPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PartRequestPhoto_partRequestId_idx" ON "PartRequestPhoto"("partRequestId");
DO $$ BEGIN
  ALTER TABLE "PartRequestPhoto" ADD CONSTRAINT "PartRequestPhoto_partRequestId_fkey"
    FOREIGN KEY ("partRequestId") REFERENCES "PartRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequestPhoto" ADD CONSTRAINT "PartRequestPhoto_ocrConfirmedById_fkey"
    FOREIGN KEY ("ocrConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequestPhoto" ADD CONSTRAINT "PartRequestPhoto_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PartRequestHistory" (
  "id" TEXT NOT NULL,
  "partRequestId" TEXT NOT NULL,
  "userId" TEXT,
  "fromStatus" "PartRequestStatus",
  "toStatus" "PartRequestStatus" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartRequestHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PartRequestHistory_partRequestId_createdAt_idx" ON "PartRequestHistory"("partRequestId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "PartRequestHistory" ADD CONSTRAINT "PartRequestHistory_partRequestId_fkey"
    FOREIGN KEY ("partRequestId") REFERENCES "PartRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PartRequestHistory" ADD CONSTRAINT "PartRequestHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 6. Chat: conversa por projeto e por atividade, e resposta a mensagem
-- ===========================================================================
ALTER TABLE "ChatChannel"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "activityId" TEXT;

DO $$ BEGIN
  ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatChannel_projectId_key" ON "ChatChannel"("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatChannel_activityId_key" ON "ChatChannel"("activityId");

-- A unicidade (organizationId, kind) valia para os dois canais fixos. Agora que
-- existem canais por projeto/atividade, ela vira um índice parcial que cobre só
-- os canais gerais (sem projeto e sem atividade). Os canais existentes continuam.
DROP INDEX IF EXISTS "ChatChannel_organizationId_kind_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ChatChannel_organizationId_kind_general_key"
  ON "ChatChannel"("organizationId", "kind")
  WHERE "projectId" IS NULL AND "activityId" IS NULL;
CREATE INDEX IF NOT EXISTS "ChatChannel_organizationId_kind_idx" ON "ChatChannel"("organizationId", "kind");

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "replyToId" TEXT;
DO $$ BEGIN
  ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_replyToId_fkey"
    FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");

-- ===========================================================================
-- 7. Notificações com link para a origem
-- ===========================================================================
ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "link" TEXT,
  ADD COLUMN IF NOT EXISTS "entity" TEXT,
  ADD COLUMN IF NOT EXISTS "entityId" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX IF NOT EXISTS "Notification_entity_entityId_idx" ON "Notification"("entity", "entityId");

-- ===========================================================================
-- 8. Permissões novas e distribuição por perfil
-- ===========================================================================
INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_fin_doc_read',  'finance.documents.read',   'Ver documentos financeiros',                   'Financeiro', CURRENT_TIMESTAMP),
  ('perm_fin_doc_manage','finance.documents.manage', 'Cadastrar e editar documentos financeiros',    'Financeiro', CURRENT_TIMESTAMP),
  ('perm_fin_doc_pay',   'finance.documents.pay',    'Registrar pagamentos e baixas',                'Financeiro', CURRENT_TIMESTAMP),
  ('perm_parts_read',    'parts.read',               'Ver solicitações de peças',                    'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_read_all','parts.read.all',           'Ver solicitações de toda a equipe',            'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_create',  'parts.create',             'Criar solicitações de peças',                  'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_analyze', 'parts.analyze',            'Analisar, aprovar e recusar solicitações',     'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_produce', 'parts.produce',            'Movimentar produção das peças',                'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_deliver', 'parts.deliver',            'Registrar entrega e conclusão',                'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_parts_cancel',  'parts.cancel',             'Cancelar solicitações',                        'Solicitação de peças', CURRENT_TIMESTAMP),
  ('perm_contractors_manage', 'contractors.manage',  'Cadastrar e gerenciar montadores externos',    'Montadores externos', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ADMIN recebe tudo o que for novo
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'ADMIN'
  AND p."code" IN (
    'finance.documents.read', 'finance.documents.manage', 'finance.documents.pay',
    'parts.read', 'parts.read.all', 'parts.create', 'parts.analyze', 'parts.produce',
    'parts.deliver', 'parts.cancel', 'contractors.manage'
  )
ON CONFLICT DO NOTHING;

-- FINANCEIRO: documentos financeiros por inteiro
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'FINANCEIRO'
  AND p."code" IN ('finance.documents.read', 'finance.documents.manage', 'finance.documents.pay')
ON CONFLICT DO NOTHING;

-- MANAGER (gestor de projetos): vê o financeiro, cuida das peças e dos montadores
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'MANAGER'
  AND p."code" IN (
    'finance.documents.read',
    'parts.read', 'parts.read.all', 'parts.create', 'parts.analyze', 'parts.cancel',
    'contractors.manage'
  )
ON CONFLICT DO NOTHING;

-- PRODUCTION e WAREHOUSE: produzem, separam e entregam as peças
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" IN ('PRODUCTION', 'WAREHOUSE')
  AND p."code" IN ('parts.read', 'parts.read.all', 'parts.produce', 'parts.deliver')
ON CONFLICT DO NOTHING;

-- MONTADOR: só cria e acompanha as próprias solicitações (parts.read sem read.all)
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'MONTADOR'
  AND p."code" IN ('parts.read', 'parts.create')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 9. Configuração padrão: antecedência do alerta de vencimento
-- ===========================================================================
INSERT INTO "Setting" ("key", "value") VALUES ('financeAlertDays', '3')
ON CONFLICT ("key") DO NOTHING;
