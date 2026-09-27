-- §23 — Quem trabalha na fábrica atualiza a própria etapa (iniciar, concluir,
-- bloquear) sem precisar de organization.manage, que abre a organização inteira.

INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_production_steps', 'production.steps', 'Atualizar etapas da produção (iniciar, concluir, bloquear, prazo)', 'Produção', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES ('ADMIN'), ('MANAGER'), ('PRODUCTION'), ('CORTE')) AS want(role_name) ON want.role_name = r."name"
JOIN "Permission" p ON p."code" = 'production.steps'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
