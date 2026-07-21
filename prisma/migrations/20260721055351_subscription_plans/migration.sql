-- CreateEnum
CREATE TYPE "PlanBillingType" AS ENUM ('recurring', 'oneTime');

-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('weekly', 'biweekly', 'monthly');

-- CreateTable
CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "billingType" "PlanBillingType" NOT NULL,
    "interval" "PlanInterval",
    "basePrice" INTEGER NOT NULL,
    "features" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stripeProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_area_tier" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "minSqFt" INTEGER NOT NULL,
    "maxSqFt" INTEGER,
    "surcharge" INTEGER NOT NULL,

    CONSTRAINT "plan_area_tier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_slug_key" ON "plan"("slug");

-- CreateIndex
CREATE INDEX "plan_area_tier_planId_idx" ON "plan_area_tier"("planId");

-- AddForeignKey
ALTER TABLE "plan_area_tier" ADD CONSTRAINT "plan_area_tier_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
