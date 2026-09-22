-- Fase 8.1: timeline central do projeto, ambientes, metas comerciais,
-- versões de template, rodadas da aprovação técnica e perfis novos.
--
-- Aditiva e idempotente: nada é removido, nenhum registro é apagado, toda
-- coluna nova é anulável ou tem DEFAULT. As etapas da timeline NÃO são criadas
-- aqui: nascem na primeira leitura de cada projeto, derivadas dos dados reais
-- (lead, briefing, contrato, medição, aprovação, produção) por uma função
-- testada — em vez de um backfill SQL que teria de adivinhar o estado.

-- ===========================================================================
-- 1. Enums
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE "TimelineStageKey" AS ENUM (
    'LEAD', 'BRIEFING', 'ORCAMENTO', 'NEGOCIACAO', 'CONTRATO', 'PAGAMENTO_ENTRADA',
    'MEDICAO', 'PROJETO_TECNICO', 'APROVACAO', 'TERMO_PRODUCAO', 'PRODUCAO',
    'PRE_MONTAGEM', 'ENTREGA', 'MONTAGEM', 'VISTORIA', 'GARANTIA', 'ASSISTENCIA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StageStatus" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'BLOQUEADA', 'NAO_APLICAVEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ApprovalRoundStatus" AS ENUM ('PUBLICADA', 'APROVADA', 'MUDANCAS_SOLICITADAS', 'SUBSTITUIDA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tipos de documento que a pasta técnica e os documentos gerados vão usar
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'ORCAMENTO';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'DESCRITIVA';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'PROJETO_TECNICO';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'TERMO_MEDICAO';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'TERMO_PRODUCAO';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'RECIBO';
ALTER TYPE "ProjectDocumentType" ADD VALUE IF NOT EXISTS 'CERTIFICADO_GARANTIA';

-- ===========================================================================
-- 2. Cliente: origem, atendimento e endereço estruturado
-- ===========================================================================
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "attendantId" TEXT,
  ADD COLUMN IF NOT EXISTS "leadSource" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "street" TEXT,
  ADD COLUMN IF NOT EXISTS "addressNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "complement" TEXT,
  ADD COLUMN IF NOT EXISTS "district" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "zipCode" TEXT;

DO $$ BEGIN
  ALTER TABLE "Client" ADD CONSTRAINT "Client_attendantId_fkey"
    FOREIGN KEY ("attendantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Client_attendantId_idx" ON "Client"("attendantId");

-- A origem vem do lead que virou este cliente: o canal do briefing, ou a
-- origem do próprio lead. Só preenche quem ainda está vazio.
UPDATE "Client" c
SET "leadSource" = sub.origem
FROM (
  SELECT DISTINCT ON (l."convertedClientId")
    l."convertedClientId" AS client_id,
    COALESCE(NULLIF(b."discoveryChannel", ''), NULLIF(l."source", '')) AS origem
  FROM "CommercialLead" l
  LEFT JOIN "LeadBriefing" b ON b."leadId" = l."id"
  WHERE l."convertedClientId" IS NOT NULL
  ORDER BY l."convertedClientId", l."createdAt" DESC
) sub
WHERE c."id" = sub.client_id
  AND c."leadSource" IS NULL
  AND sub.origem IS NOT NULL;

-- ===========================================================================
-- 3. Projeto: arquiteto e 3D
-- ===========================================================================
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "architectName" TEXT,
  ADD COLUMN IF NOT EXISTS "architectPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "architectEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "link3dUrl" TEXT;

-- ===========================================================================
-- 4. Timeline do projeto
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "ProjectStage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "key" "TimelineStageKey" NOT NULL,
  "position" INTEGER NOT NULL,
  "status" "StageStatus" NOT NULL DEFAULT 'PENDENTE',
  "responsibleId" TEXT,
  "plannedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectStage_projectId_key_key" ON "ProjectStage"("projectId", "key");
CREATE INDEX IF NOT EXISTS "ProjectStage_organizationId_key_status_idx" ON "ProjectStage"("organizationId", "key", "status");
CREATE INDEX IF NOT EXISTS "ProjectStage_responsibleId_status_idx" ON "ProjectStage"("responsibleId", "status");
CREATE INDEX IF NOT EXISTS "ProjectStage_plannedAt_idx" ON "ProjectStage"("plannedAt");
DO $$ BEGIN
  ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_responsibleId_fkey"
    FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProjectStageEvent" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "userId" TEXT,
  "field" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectStageEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectStageEvent_stageId_createdAt_idx" ON "ProjectStageEvent"("stageId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "ProjectStageEvent" ADD CONSTRAINT "ProjectStageEvent_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectStageEvent" ADD CONSTRAINT "ProjectStageEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 5. Ambientes
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "ProjectRoom" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "roomType" "RoomType",
  "notes" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectRoom_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProjectRoom_projectId_position_idx" ON "ProjectRoom"("projectId", "position");
DO $$ BEGIN
  ALTER TABLE "ProjectRoom" ADD CONSTRAINT "ProjectRoom_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 6. Metas comerciais
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "SalesGoal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "month" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesGoal_organizationId_userId_month_key" ON "SalesGoal"("organizationId", "userId", "month");
CREATE INDEX IF NOT EXISTS "SalesGoal_organizationId_month_idx" ON "SalesGoal"("organizationId", "month");
-- NULL não colide em índice único: sem isto, dava para gravar duas metas da loja no mesmo mês
CREATE UNIQUE INDEX IF NOT EXISTS "SalesGoal_org_month_store_key" ON "SalesGoal"("organizationId", "month") WHERE "userId" IS NULL;
DO $$ BEGIN
  ALTER TABLE "SalesGoal" ADD CONSTRAINT "SalesGoal_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SalesGoal" ADD CONSTRAINT "SalesGoal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 7. Versões de template
-- ===========================================================================
ALTER TABLE "DocumentTemplate" ADD COLUMN IF NOT EXISTS "currentVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "DocumentTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "bodyHtml" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");
DO $$ BEGIN
  ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cada modelo existente ganha a versão 1 com o texto de hoje, publicada:
-- o histórico começa consistente e nada que já foi gerado perde a referência.
INSERT INTO "DocumentTemplateVersion" ("id", "templateId", "version", "bodyHtml", "notes", "createdById", "publishedAt", "createdAt")
SELECT md5('tplv1:' || t."id"), t."id", 1, t."bodyHtml", 'Versão inicial (existente antes do versionamento)', t."createdById", t."createdAt", t."createdAt"
FROM "DocumentTemplate" t
ON CONFLICT ("templateId", "version") DO NOTHING;

-- ===========================================================================
-- 8. Rodadas da aprovação técnica
-- ===========================================================================
CREATE TABLE IF NOT EXISTS "TechApprovalRound" (
  "id" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "documentId" TEXT,
  "status" "ApprovalRoundStatus" NOT NULL DEFAULT 'PUBLICADA',
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedByName" TEXT,
  "clientComment" TEXT,
  "documentChecksum" TEXT,
  CONSTRAINT "TechApprovalRound_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TechApprovalRound_approvalId_round_key" ON "TechApprovalRound"("approvalId", "round");
DO $$ BEGIN
  ALTER TABLE "TechApprovalRound" ADD CONSTRAINT "TechApprovalRound_approvalId_fkey"
    FOREIGN KEY ("approvalId") REFERENCES "TechnicalProjectApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TechApprovalRound" ADD CONSTRAINT "TechApprovalRound_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TechApprovalRound" ADD CONSTRAINT "TechApprovalRound_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A rodada em curso de cada aprovação já publicada vira a primeira linha do
-- histórico. As rodadas anteriores a esta já tiveram o comentário apagado pelo
-- código antigo: não há como recuperá-las, mas daqui em diante nada se perde.
INSERT INTO "TechApprovalRound" (
  "id", "approvalId", "round", "documentId", "status", "publishedAt", "publishedById",
  "decidedAt", "decidedByName", "clientComment", "documentChecksum"
)
SELECT
  md5('round:' || a."id" || ':' || a."reviewRound"),
  a."id",
  a."reviewRound",
  a."documentId",
  CASE a."status"
    WHEN 'APPROVED' THEN 'APROVADA'::"ApprovalRoundStatus"
    WHEN 'CHANGES_REQUESTED' THEN 'MUDANCAS_SOLICITADAS'::"ApprovalRoundStatus"
    ELSE 'PUBLICADA'::"ApprovalRoundStatus"
  END,
  COALESCE(a."publishedAt", a."createdAt"),
  a."publishedById",
  CASE WHEN a."status" IN ('APPROVED', 'CHANGES_REQUESTED') THEN COALESCE(a."approvedAt", a."updatedAt") END,
  a."approvedByName",
  a."clientComment",
  d."checksum"
FROM "TechnicalProjectApproval" a
LEFT JOIN "ProjectDocument" d ON d."id" = a."documentId"
WHERE a."status" <> 'DRAFT'
ON CONFLICT ("approvalId", "round") DO NOTHING;

-- ===========================================================================
-- 9. Permissões
-- ===========================================================================
INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_timeline_read',   'timeline.read',            'Ver a timeline dos projetos',                      'Projetos',  CURRENT_TIMESTAMP),
  ('perm_timeline_edit',   'timeline.edit',            'Atualizar etapas, responsáveis e prazos',          'Projetos',  CURRENT_TIMESTAMP),
  ('perm_clients_read_all','clients.read.all',         'Ver clientes de toda a equipe (sem isto, só a carteira própria)', 'Clientes', CURRENT_TIMESTAMP),
  ('perm_goals_manage',    'commercial.goals.manage',  'Definir metas comerciais',                          'Comercial', CURRENT_TIMESTAMP),
  ('perm_templates_version','templates.versions',      'Criar e publicar versões de modelos',              'Documentos', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Compatibilidade: todo perfil que já enxergava os clientes continua enxergando
-- todos. Só o CONSULTOR (abaixo) nasce restrito à própria carteira.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" base ON base."id" = rp."permissionId" AND base."code" = 'organization.read'
CROSS JOIN "Permission" p
WHERE p."code" IN ('clients.read.all', 'timeline.read')
ON CONFLICT DO NOTHING;

-- quem gerencia projetos hoje também atualiza a timeline
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" base ON base."id" = rp."permissionId" AND base."code" = 'organization.manage'
CROSS JOIN "Permission" p
WHERE p."code" = 'timeline.edit'
ON CONFLICT DO NOTHING;

-- ADMIN recebe tudo o que é novo; metas vão também para quem gerencia o comercial
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'ADMIN'
  AND p."code" IN ('timeline.read', 'timeline.edit', 'clients.read.all', 'commercial.goals.manage', 'templates.versions')
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" base ON base."id" = rp."permissionId" AND base."code" = 'commercial.manage'
CROSS JOIN "Permission" p
WHERE p."code" = 'commercial.goals.manage'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" base ON base."id" = rp."permissionId" AND base."code" = 'documents.manage'
CROSS JOIN "Permission" p
WHERE p."code" = 'templates.versions'
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 10. Perfis novos. Os atuais (MANAGER, WAREHOUSE, REQUESTER, VIEWER...) ficam.
-- ===========================================================================
INSERT INTO "Role" ("id", "name", "label", "description", "createdAt") VALUES
  ('role_comercial',   'COMERCIAL',   'Comercial',          'Gestão comercial: funil de toda a equipe, metas, contratos',       CURRENT_TIMESTAMP),
  ('role_consultor',   'CONSULTOR',   'Consultor de vendas','Atende a própria carteira: leads, clientes, orçamentos e agenda',  CURRENT_TIMESTAMP),
  ('role_projetista',  'PROJETISTA',  'Projetista',         'Medição, projeto técnico, descritiva e aprovação',                 CURRENT_TIMESTAMP),
  ('role_assistencia', 'ASSISTENCIA', 'Assistência técnica','Vistoria, garantia, assistência e manutenção preventiva',          CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- COMERCIAL: toda a carteira
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'COMERCIAL' AND p."code" IN (
  'dashboard.read', 'notifications.read', 'chat.use',
  'organization.read', 'organization.tasks.create', 'organization.tasks.edit', 'organization.tasks.comment',
  'clients.read.all', 'timeline.read', 'timeline.edit',
  'commercial.read', 'commercial.read.all', 'commercial.manage', 'commercial.leads.manage',
  'commercial.quotes.manage', 'commercial.orders.manage', 'commercial.commissions.manage', 'commercial.goals.manage',
  'documents.read', 'documents.manage', 'finance.read',
  'agenda.read', 'agenda.read.all', 'agenda.create', 'agenda.edit', 'agenda.cancel', 'reports.read'
)
ON CONFLICT DO NOTHING;

-- CONSULTOR: só a própria carteira — sem commercial.read.all e sem clients.read.all
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'CONSULTOR' AND p."code" IN (
  'dashboard.read', 'notifications.read', 'chat.use',
  'organization.read', 'organization.tasks.create', 'organization.tasks.edit', 'organization.tasks.comment',
  'timeline.read', 'timeline.edit',
  'commercial.read', 'commercial.leads.manage', 'commercial.quotes.manage', 'commercial.orders.manage',
  'documents.read',
  'agenda.read', 'agenda.create', 'agenda.edit', 'agenda.cancel'
)
ON CONFLICT DO NOTHING;

-- PROJETISTA: medição e projeto técnico
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'PROJETISTA' AND p."code" IN (
  'dashboard.read', 'notifications.read', 'chat.use',
  'organization.read', 'organization.manage', 'organization.tasks.create', 'organization.tasks.edit', 'organization.tasks.comment',
  'clients.read.all', 'timeline.read', 'timeline.edit',
  'documents.read', 'documents.manage', 'templates.versions',
  'agenda.read', 'agenda.read.all', 'agenda.create', 'agenda.edit', 'agenda.cancel',
  'parts.read', 'parts.read.all'
)
ON CONFLICT DO NOTHING;

-- ASSISTENCIA: pós-venda
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'ASSISTENCIA' AND p."code" IN (
  'dashboard.read', 'notifications.read', 'chat.use',
  'organization.read', 'organization.tasks.create', 'organization.tasks.edit', 'organization.tasks.comment',
  'clients.read.all', 'timeline.read', 'timeline.edit',
  'documents.read', 'documents.manage',
  'agenda.read', 'agenda.read.all', 'agenda.create', 'agenda.edit', 'agenda.cancel',
  'parts.read', 'parts.read.all', 'parts.create', 'parts.analyze'
)
ON CONFLICT DO NOTHING;
