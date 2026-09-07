-- CreateTable
CREATE TABLE "DreCategoryMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dreLine" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DreCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DreCategoryMapping_organizationId_idx" ON "DreCategoryMapping"("organizationId");
CREATE UNIQUE INDEX "DreCategoryMapping_organizationId_category_key" ON "DreCategoryMapping"("organizationId", "category");

-- AddForeignKey
ALTER TABLE "DreCategoryMapping" ADD CONSTRAINT "DreCategoryMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
