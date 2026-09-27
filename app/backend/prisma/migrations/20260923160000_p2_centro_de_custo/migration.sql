-- §31 — Centro de custo no financeiro.
--
-- O lançamento já tinha "categoria" (a natureza do gasto) e "projeto" (a obra).
-- Faltava o SETOR que consumiu o valor, que é a terceira dimensão pedida pela
-- especificação e a que permite ver quanto cada área gasta.
--
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "CostCenter" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "CostCenter"
    ADD CONSTRAINT "CostCenter_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "CostCenter_organizationId_code_key" ON "CostCenter" ("organizationId", "code");

CREATE INDEX IF NOT EXISTS "CostCenter_organizationId_active_idx" ON "CostCenter" ("organizationId", "active");

ALTER TABLE "FinanceTransaction" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;

DO $$
BEGIN
  ALTER TABLE "FinanceTransaction"
    ADD CONSTRAINT "FinanceTransaction_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS "FinanceTransaction_costCenterId_idx" ON "FinanceTransaction" ("costCenterId");

-- Centros iniciais espelhando os setores que a organização já usa. Sem isto a
-- tela nasce vazia e ninguém classifica nada.
INSERT INTO "CostCenter" ("id", "organizationId", "code", "name", "active", "createdAt", "updatedAt")
SELECT md5('cc:' || o."id" || ':' || c.code), o."id", c.code, c.name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('PROD', 'Produção'),
  ('MONT', 'Montagem'),
  ('ALMOX', 'Almoxarifado'),
  ('COM',  'Comercial'),
  ('ADM',  'Administrativo'),
  ('ASSIST', 'Assistência técnica'),
  ('LOJA', 'Loja / showroom')
) AS c(code, name)
ON CONFLICT ("organizationId", "code") DO NOTHING;
