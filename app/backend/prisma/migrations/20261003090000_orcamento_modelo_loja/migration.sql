-- Orçamento no modelo da loja: acabamentos de cada ambiente.
ALTER TABLE "CommercialQuoteItem" ADD COLUMN IF NOT EXISTS "corpo" TEXT;
ALTER TABLE "CommercialQuoteItem" ADD COLUMN IF NOT EXISTS "porta" TEXT;
ALTER TABLE "CommercialQuoteItem" ADD COLUMN IF NOT EXISTS "puxador" TEXT;
ALTER TABLE "CommercialQuoteItem" ADD COLUMN IF NOT EXISTS "complemento" TEXT;
ALTER TABLE "CommercialQuoteItem" ADD COLUMN IF NOT EXISTS "modelo" TEXT;
