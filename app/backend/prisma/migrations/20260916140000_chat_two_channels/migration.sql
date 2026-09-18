-- Chat com dois canais fixos por organização: "Equipe" e "Equipe + montadores".
-- Remove conversa direta/grupos (ainda sem dados: o chat não tinha ido ao ar).

DELETE FROM "ChatChannel" WHERE "kind"::text IN ('GROUP', 'DIRECT');

DROP INDEX IF EXISTS "ChatChannel_organizationId_directKey_key";
DROP INDEX IF EXISTS "ChatChannel_organizationId_kind_idx";
ALTER TABLE "ChatChannel" DROP COLUMN IF EXISTS "directKey";

ALTER TYPE "ChatChannelKind" RENAME TO "ChatChannelKind_old";
CREATE TYPE "ChatChannelKind" AS ENUM ('TEAM', 'CONTRACTORS');
ALTER TABLE "ChatChannel" ALTER COLUMN "kind" TYPE "ChatChannelKind" USING ("kind"::text::"ChatChannelKind");
DROP TYPE "ChatChannelKind_old";

-- um canal de cada tipo por organização
CREATE UNIQUE INDEX "ChatChannel_organizationId_kind_key" ON "ChatChannel"("organizationId", "kind");

-- chat.manage passa a ser só moderação (apagar mensagem de outros)
UPDATE "Permission" SET "label" = 'Moderar o chat (apagar mensagens de outros)' WHERE "code" = 'chat.manage';
