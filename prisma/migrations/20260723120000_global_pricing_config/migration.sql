-- Unify per-plan area-surcharge tiers into a single global PricingConfig.
-- Creates the shared config + tier tables, migrates the existing (identical)
-- per-plan ladder into the global one, then drops the per-plan table.

-- CreateTable
CREATE TABLE "pricing_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maxAreaSqFt" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_tier" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "minSqFt" INTEGER NOT NULL,
    "maxSqFt" INTEGER,
    "surcharge" INTEGER NOT NULL,

    CONSTRAINT "area_tier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "area_tier_configId_idx" ON "area_tier"("configId");

-- AddForeignKey
ALTER TABLE "area_tier" ADD CONSTRAINT "area_tier_configId_fkey" FOREIGN KEY ("configId") REFERENCES "pricing_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the singleton config row (no maximum area until an admin sets one).
INSERT INTO "pricing_config" ("id", "maxAreaSqFt", "updatedAt")
VALUES ('singleton', NULL, CURRENT_TIMESTAMP);

-- Migrate the existing per-plan ladder into the global config. All plans share
-- an identical, non-overlapping ladder (see scripts/seed-plans.mjs), so DISTINCT
-- collapses the duplicates into the single shared bracket set.
INSERT INTO "area_tier" ("id", "configId", "minSqFt", "maxSqFt", "surcharge")
SELECT gen_random_uuid()::text, 'singleton', t."minSqFt", t."maxSqFt", t."surcharge"
FROM (
    SELECT DISTINCT "minSqFt", "maxSqFt", "surcharge" FROM "plan_area_tier"
) t;

-- DropTable (per-plan tiers are now redundant)
DROP TABLE "plan_area_tier";
