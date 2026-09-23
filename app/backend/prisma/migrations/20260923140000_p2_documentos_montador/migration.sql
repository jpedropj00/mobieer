-- §7 — Entrega e assinatura dos documentos do montador.
--
-- A tabela ContractorDocument existia e o montador já conseguia ler, mas não
-- havia rota para a empresa enviar nem nenhum controle de status: na prática
-- era tabela morta. Aqui entram os seis status da especificação e as datas que
-- provam quando cada passo aconteceu.
--
-- Aditiva e idempotente.

-- Tipos que faltavam (§7: termo de ferramentas, regulamento, regras da empresa).
-- Fora de bloco DO: ALTER TYPE ADD VALUE não roda dentro de função.
ALTER TYPE "ContractorDocumentType" ADD VALUE IF NOT EXISTS 'TERMO_RESPONSABILIDADE';

ALTER TYPE "ContractorDocumentType" ADD VALUE IF NOT EXISTS 'REGULAMENTO_INTERNO';

ALTER TYPE "ContractorDocumentType" ADD VALUE IF NOT EXISTS 'REGRAS_EMPRESA';

-- CREATE TYPE não aceita IF NOT EXISTS, então a repetição é tratada no catch.
DO $$
BEGIN
  CREATE TYPE "ContractorDocumentStatus" AS ENUM (
    'AGUARDANDO_ENVIO', 'ENVIADO', 'VISUALIZADO', 'AGUARDANDO_ASSINATURA', 'ASSINADO', 'RECUSADO'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "ContractorDocument"
  ADD COLUMN IF NOT EXISTS "status" "ContractorDocumentStatus" NOT NULL DEFAULT 'AGUARDANDO_ENVIO',
  ADD COLUMN IF NOT EXISTS "requiresSignature" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refusedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refusalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "signatureDataUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "signerName" TEXT,
  ADD COLUMN IF NOT EXISTS "signerIp" TEXT;

-- Documento que já estava na tabela foi anexado antes de existir fluxo de
-- entrega: o montador já o enxergava, então nasce como ENVIADO em vez de
-- sumir da vista dele por causa do default.
UPDATE "ContractorDocument"
   SET "status" = 'ENVIADO', "sentAt" = "createdAt"
 WHERE "sentAt" IS NULL AND "status" = 'AGUARDANDO_ENVIO';

CREATE INDEX IF NOT EXISTS "ContractorDocument_contractorId_status_idx"
  ON "ContractorDocument" ("contractorId", "status");
