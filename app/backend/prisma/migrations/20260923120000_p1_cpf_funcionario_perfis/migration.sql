-- Prioridade 1 da especificação: CPF do funcionário (§2) e os perfis que faltavam (§1).
-- Aditiva e idempotente: roda em banco que já tem dados.

-- ============================================================
-- §2 — CPF do funcionário
-- ============================================================
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "document" TEXT;

-- CPF não repete dentro da organização. No Postgres vários NULL convivem num
-- índice único, então quem ainda não tem CPF não trava o cadastro.
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_organizationId_document_key"
  ON "Employee" ("organizationId", "document");

-- ============================================================
-- §1 — Perfis que a especificação pede e não existiam
-- ============================================================
INSERT INTO "Role" ("id", "name", "label", "description", "createdAt")
VALUES
  (md5('role:CORTE'),            'CORTE',            'Corte',            'Setor de corte: plano de corte, peças liberadas e conferência', CURRENT_TIMESTAMP),
  (md5('role:COMPRAS'),          'COMPRAS',          'Compras',          'Fornecedores, cotações, pedidos de compra e entrada de material', CURRENT_TIMESTAMP),
  (md5('role:TECNICO'),          'TECNICO',          'Técnico',          'Campo: medição, vistoria e atendimento de assistência', CURRENT_TIMESTAMP),
  (md5('role:FUNCIONARIO'),      'FUNCIONARIO',      'Funcionário',      'Acesso básico: próprias atividades, agenda, tarefas e chat', CURRENT_TIMESTAMP),
  (md5('role:MONTADOR_INTERNO'), 'MONTADOR_INTERNO', 'Montador interno', 'Montagem pela equipe da casa: atividades, peças e agenda', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Permissões de cada perfil novo. O SELECT casa pelo código da permissão, então
-- um código que não exista é simplesmente ignorado em vez de quebrar a migration.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  -- CORTE
  ('CORTE', 'dashboard.read'), ('CORTE', 'notifications.read'), ('CORTE', 'chat.use'),
  ('CORTE', 'organization.read'), ('CORTE', 'timeline.read'), ('CORTE', 'documents.read'),
  ('CORTE', 'products.read'), ('CORTE', 'stock.read'), ('CORTE', 'agenda.read'),
  ('CORTE', 'requisitions.read'), ('CORTE', 'requisitions.read.all'),
  ('CORTE', 'requisitions.cut'), ('CORTE', 'requisitions.release'),
  ('CORTE', 'parts.read'), ('CORTE', 'parts.read.all'), ('CORTE', 'parts.produce'),

  -- COMPRAS
  ('COMPRAS', 'dashboard.read'), ('COMPRAS', 'notifications.read'), ('COMPRAS', 'chat.use'),
  ('COMPRAS', 'organization.read'), ('COMPRAS', 'documents.read'), ('COMPRAS', 'agenda.read'),
  ('COMPRAS', 'suppliers.read'), ('COMPRAS', 'suppliers.create'), ('COMPRAS', 'suppliers.update'),
  ('COMPRAS', 'products.read'), ('COMPRAS', 'products.create'), ('COMPRAS', 'products.update'),
  ('COMPRAS', 'categories.read'), ('COMPRAS', 'warehouses.read'),
  ('COMPRAS', 'stock.read'), ('COMPRAS', 'stock.entry'), ('COMPRAS', 'stock.movements'),
  ('COMPRAS', 'requisitions.read'), ('COMPRAS', 'requisitions.read.all'),
  ('COMPRAS', 'finance.read'), ('COMPRAS', 'finance.documents.read'), ('COMPRAS', 'finance.documents.manage'),
  ('COMPRAS', 'reports.read'),

  -- TECNICO
  ('TECNICO', 'dashboard.read'), ('TECNICO', 'notifications.read'), ('TECNICO', 'chat.use'),
  ('TECNICO', 'organization.read'), ('TECNICO', 'organization.tasks.create'),
  ('TECNICO', 'organization.tasks.edit'), ('TECNICO', 'organization.tasks.comment'),
  ('TECNICO', 'clients.read.all'), ('TECNICO', 'timeline.read'), ('TECNICO', 'timeline.edit'),
  ('TECNICO', 'activities.read'), ('TECNICO', 'activities.create'), ('TECNICO', 'activities.edit'),
  ('TECNICO', 'activities.complete'), ('TECNICO', 'activities.sign'),
  ('TECNICO', 'agenda.read'), ('TECNICO', 'agenda.read.all'), ('TECNICO', 'agenda.create'),
  ('TECNICO', 'agenda.edit'), ('TECNICO', 'agenda.cancel'),
  ('TECNICO', 'parts.read'), ('TECNICO', 'parts.create'),
  ('TECNICO', 'documents.read'), ('TECNICO', 'documents.manage'),

  -- FUNCIONARIO (acesso básico, sem ver carteira de cliente)
  ('FUNCIONARIO', 'dashboard.read'), ('FUNCIONARIO', 'notifications.read'), ('FUNCIONARIO', 'chat.use'),
  ('FUNCIONARIO', 'organization.read'), ('FUNCIONARIO', 'organization.tasks.create'),
  ('FUNCIONARIO', 'organization.tasks.edit'), ('FUNCIONARIO', 'organization.tasks.comment'),
  ('FUNCIONARIO', 'activities.read'), ('FUNCIONARIO', 'activities.create'),
  ('FUNCIONARIO', 'activities.edit'), ('FUNCIONARIO', 'activities.complete'),
  ('FUNCIONARIO', 'agenda.read'), ('FUNCIONARIO', 'agenda.create'),
  ('FUNCIONARIO', 'documents.read'),

  -- MONTADOR_INTERNO (equipe da casa; sem contractors.self, que é do externo)
  ('MONTADOR_INTERNO', 'dashboard.read'), ('MONTADOR_INTERNO', 'notifications.read'), ('MONTADOR_INTERNO', 'chat.use'),
  ('MONTADOR_INTERNO', 'organization.read'), ('MONTADOR_INTERNO', 'organization.tasks.comment'),
  ('MONTADOR_INTERNO', 'timeline.read'), ('MONTADOR_INTERNO', 'documents.read'),
  ('MONTADOR_INTERNO', 'activities.read'), ('MONTADOR_INTERNO', 'activities.create'),
  ('MONTADOR_INTERNO', 'activities.edit'), ('MONTADOR_INTERNO', 'activities.complete'),
  ('MONTADOR_INTERNO', 'activities.sign'), ('MONTADOR_INTERNO', 'agenda.read'),
  ('MONTADOR_INTERNO', 'parts.read'), ('MONTADOR_INTERNO', 'parts.create'),
  ('MONTADOR_INTERNO', 'requisitions.read'), ('MONTADOR_INTERNO', 'requisitions.create')
) AS want(role_name, perm_code) ON want.role_name = r."name"
JOIN "Permission" p ON p."code" = want.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- O perfil PRODUCTION chamava-se "Produção / Corte" porque o corte não tinha
-- perfil próprio. Agora tem, então o rótulo volta a ser só Produção.
UPDATE "Role" SET "label" = 'Produção' WHERE "name" = 'PRODUCTION' AND "label" = 'Produção / Corte';
