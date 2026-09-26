-- §5 — Metas mensais de produtividade por funcionário. Os indicadores em si
-- saem dos dados reais na leitura; só a meta é gravada. Aditiva e idempotente.

DO $$
BEGIN
  CREATE TYPE "ProductivityMetric" AS ENUM ('ACTIVITIES_DONE', 'PRODUCTION_STEPS', 'PRODUCTION_HOURS', 'TASKS_DONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "EmployeeGoal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "metric" "ProductivityMetric" NOT NULL,
    "target" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmployeeGoal_organizationId_month_idx" ON "EmployeeGoal"("organizationId", "month");

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeGoal_userId_month_metric_key" ON "EmployeeGoal"("userId", "month", "metric");

DO $$
BEGIN
  ALTER TABLE "EmployeeGoal" ADD CONSTRAINT "EmployeeGoal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "EmployeeGoal" ADD CONSTRAINT "EmployeeGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "EmployeeGoal" ADD CONSTRAINT "EmployeeGoal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;


INSERT INTO "Permission" ("id", "code", "label", "module", "createdAt") VALUES
  ('perm_productivity_read',   'productivity.read',   'Ver produtividade da equipe (indicadores mensais)', 'Produtividade', CURRENT_TIMESTAMP),
  ('perm_productivity_manage', 'productivity.manage', 'Definir metas de produtividade',                    'Produtividade', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Todo usuário vê a PRÓPRIA produtividade sem permissão extra (conferido no
-- backend); ver a equipe é da gestão, do RH e da produção.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN (VALUES
  ('ADMIN', 'productivity.read'), ('ADMIN', 'productivity.manage'),
  ('MANAGER', 'productivity.read'), ('MANAGER', 'productivity.manage'),
  ('RH', 'productivity.read'), ('RH', 'productivity.manage'),
  ('PRODUCTION', 'productivity.read')
) AS want(role_name, perm_code) ON want.role_name = r."name"
JOIN "Permission" p ON p."code" = want.perm_code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
