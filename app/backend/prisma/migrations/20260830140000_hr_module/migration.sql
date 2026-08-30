-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "VacationPeriodStatus" AS ENUM ('OPEN', 'SCHEDULED', 'CONCLUDED');

-- CreateEnum
CREATE TYPE "VacationRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'SCHEDULED', 'TAKEN', 'CANCELLED');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT,
    "sector" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "admittedAt" TIMESTAMP(3) NOT NULL,
    "terminatedAt" TIMESTAMP(3),
    "weeklyHours" INTEGER NOT NULL DEFAULT 44,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationPeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "accrualStart" TIMESTAMP(3) NOT NULL,
    "accrualEnd" TIMESTAMP(3) NOT NULL,
    "concessionLimit" TIMESTAMP(3) NOT NULL,
    "daysEntitled" INTEGER NOT NULL DEFAULT 30,
    "daysTaken" INTEGER NOT NULL DEFAULT 0,
    "status" "VacationPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacationRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "sellDays" INTEGER NOT NULL DEFAULT 0,
    "status" "VacationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_organizationId_status_idx" ON "Employee"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_organizationId_registration_key" ON "Employee"("organizationId", "registration");

-- CreateIndex
CREATE INDEX "VacationPeriod_employeeId_status_idx" ON "VacationPeriod"("employeeId", "status");

-- CreateIndex
CREATE INDEX "VacationPeriod_concessionLimit_idx" ON "VacationPeriod"("concessionLimit");

-- CreateIndex
CREATE INDEX "VacationRequest_employeeId_status_idx" ON "VacationRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "VacationRequest_status_startDate_idx" ON "VacationRequest"("status", "startDate");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationPeriod" ADD CONSTRAINT "VacationPeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "VacationPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacationRequest" ADD CONSTRAINT "VacationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
