-- Orçamento: desconto informado em % ou como valor final combinado com o cliente.
-- Vazio nos dois = desconto em R$, como sempre foi.
ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(7,4);
ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "targetTotal" DECIMAL(14,2);
