-- Negociação por orçamento: prazo de entrega combinado (texto e dias).
ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "deliveryText" TEXT;
ALTER TABLE "CommercialQuote" ADD COLUMN IF NOT EXISTS "deliveryDays" INTEGER;
