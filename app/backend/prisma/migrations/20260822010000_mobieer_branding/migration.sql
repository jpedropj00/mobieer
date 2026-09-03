UPDATE "Enterprise"
SET "legalName" = 'MOBIEER', "tradeName" = 'MOBIEER', "slug" = 'mobieer', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default-enterprise' AND "slug" = 'gestium';

UPDATE "Organization"
SET "name" = 'MOBIEER'
WHERE "id" = 'default-org' AND "name" = 'Gestium';

UPDATE "Setting"
SET "value" = 'MOBIEER'
WHERE "key" = 'companyName' AND "value" = 'Gestium';
