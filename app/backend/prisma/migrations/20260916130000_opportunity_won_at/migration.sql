-- Data em que a oportunidade virou venda.
ALTER TABLE "CommercialOpportunity" ADD COLUMN "wonAt" TIMESTAMP(3);

-- Vendas já ganhas: melhor aproximação disponível é a última atualização.
UPDATE "CommercialOpportunity" SET "wonAt" = "updatedAt" WHERE "status" = 'WON' AND "wonAt" IS NULL;

CREATE INDEX "CommercialOpportunity_organizationId_wonAt_idx" ON "CommercialOpportunity"("organizationId", "wonAt");
