-- Cadastro curto do cliente pelo site: a conta nasce ligada ao lead, com
-- acesso só ao briefing, e passa a acesso completo quando a equipe completa o
-- cadastro (converte o lead em cliente).

CREATE TYPE "ClientAccessLevel" AS ENUM ('BRIEFING', 'FULL');

ALTER TABLE "ClientAccount" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "ClientAccount" ADD COLUMN "leadId" TEXT;
ALTER TABLE "ClientAccount" ADD COLUMN "accessLevel" "ClientAccessLevel" NOT NULL DEFAULT 'FULL';
ALTER TABLE "ClientAccount" ADD COLUMN "document" TEXT;

CREATE UNIQUE INDEX "ClientAccount_leadId_key" ON "ClientAccount"("leadId");
CREATE UNIQUE INDEX "ClientAccount_document_key" ON "ClientAccount"("document");

ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CommercialLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conta de cliente precisa estar ligada a um cliente OU a um lead.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_client_or_lead_check" CHECK ("clientId" IS NOT NULL OR "leadId" IS NOT NULL);
-- Acesso completo exige cliente.
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_full_requires_client_check" CHECK ("accessLevel" = 'BRIEFING' OR "clientId" IS NOT NULL);

ALTER TABLE "CommercialLead" ADD COLUMN "document" TEXT;

-- Assistência aberta pelo cliente: tipo do problema e cômodo
ALTER TABLE "AssistanceTicket" ADD COLUMN "problemType" TEXT;
ALTER TABLE "AssistanceTicket" ADD COLUMN "roomLabel" TEXT;
