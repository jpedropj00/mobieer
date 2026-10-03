-- Etiquetas da produção: cada item ganha um código de barras único na organização
-- e os dados que saem impressos (medidas, módulo, fita de borda).
ALTER TABLE "ProductionItem" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "ProductionItem" ADD COLUMN IF NOT EXISTS "medidas" TEXT;
ALTER TABLE "ProductionItem" ADD COLUMN IF NOT EXISTS "modulo" TEXT;
ALTER TABLE "ProductionItem" ADD COLUMN IF NOT EXISTS "fita" TEXT;

-- itens que já existiam recebem um código na ordem em que foram criados
UPDATE "ProductionItem" p
SET "code" = n.code
FROM (
  SELECT "id", (10000000 + ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", "id"))::text AS code
  FROM "ProductionItem"
  WHERE "code" IS NULL
) n
WHERE p."id" = n."id" AND p."code" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionItem_organizationId_code_key" ON "ProductionItem"("organizationId", "code");
