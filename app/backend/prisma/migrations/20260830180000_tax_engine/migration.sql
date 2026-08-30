-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- CreateEnum
CREATE TYPE "TipoImposto" AS ENUM ('DAS', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'ISS', 'ICMS');

-- AlterTable
ALTER TABLE "Enterprise"
    ADD COLUMN "regimeTributario" "RegimeTributario" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
    ADD COLUMN "cnae" TEXT,
    ADD COLUMN "uf" TEXT,
    ADD COLUMN "municipio" TEXT,
    ADD COLUMN "inscricaoEstadual" TEXT;

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "regimeTributario" "RegimeTributario" NOT NULL,
    "tipoImposto" "TipoImposto" NOT NULL,
    "cnae" TEXT,
    "uf" TEXT,
    "aliquota" DECIMAL(6,4) NOT NULL,
    "reducaoBase" DECIMAL(6,4),
    "faixaFaturamentoMin" DECIMAL(14,2),
    "faixaFaturamentoMax" DECIMAL(14,2),
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaFim" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxRule_organizationId_regimeTributario_tipoImposto_ativo_idx" ON "TaxRule"("organizationId", "regimeTributario", "tipoImposto", "ativo");

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
