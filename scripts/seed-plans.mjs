// Seed the four booking plans that replace the previously-hardcoded frequency
// tiers (Weekly / Bi-weekly / Monthly / One-time). Running this keeps the
// booking flow populated after the switch to admin-managed Plan records.
//
// Prices are in CENTS. Final per-visit charge = basePrice + the surcharge of the
// area tier the measured lawn falls into. The area surcharge ladder is GLOBAL
// (a single shared PricingConfig), not per-plan. These are sensible starting
// values — admins can edit them in the console under Settings → Pricing.
//
// Idempotent: upserts each plan by its unique slug and rewrites the single
// global pricing config, so re-running is safe.
//
// Usage (from the LawnBackend directory):
//   pnpm seed:plans

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "..", ".env") });

if (!process.env.DATABASE_URL) {
  console.error("\n✖ DATABASE_URL is not set (checked LawnBackend/.env).\n");
  process.exit(1);
}

// The single global, non-overlapping area surcharge ladder shared by every
// plan (cents). Lives in PricingConfig ("singleton"), not on any plan.
const AREA_TIERS = [
  { minSqFt: 0, maxSqFt: 2500, surcharge: 0 },
  { minSqFt: 2500, maxSqFt: 5000, surcharge: 1500 },
  { minSqFt: 5000, maxSqFt: 10000, surcharge: 3500 },
  { minSqFt: 10000, maxSqFt: null, surcharge: 6000 },
];

// null = no maximum serviceable area (never block a booking for being too big).
const MAX_AREA_SQFT = null;

const PLANS = [
  {
    slug: "weekly",
    name: "Weekly",
    description: "A fresh cut every week — the tidiest option.",
    billingType: "recurring",
    interval: "weekly",
    basePrice: 3200,
    features: ["Every week", "Save 15% vs one-time", "Priority scheduling"],
    sortOrder: 0,
  },
  {
    slug: "biweekly",
    name: "Bi-weekly",
    description: "Every two weeks — the popular balance of tidy and thrifty.",
    billingType: "recurring",
    interval: "biweekly",
    basePrice: 3400,
    features: ["Every two weeks", "Save 10% vs one-time", "Flexible scheduling"],
    sortOrder: 1,
  },
  {
    slug: "monthly",
    name: "Monthly",
    description: "Once a month upkeep for low-maintenance lawns.",
    billingType: "recurring",
    interval: "monthly",
    basePrice: 3600,
    features: ["Once a month", "Save 5% vs one-time"],
    sortOrder: 2,
  },
  {
    slug: "one-time",
    name: "One-time",
    description: "A single visit with no commitment.",
    billingType: "oneTime",
    interval: null,
    basePrice: 4000,
    features: ["Single visit", "No commitment"],
    sortOrder: 3,
  },
];

async function upsertPlan(client, plan) {
  const { rows } = await client.query(
    `INSERT INTO "plan"
       (id, name, slug, description, "billingType", interval, "basePrice",
        features, active, "sortOrder", "updatedAt")
     VALUES
       ($1, $2, $3, $4, $5::"PlanBillingType", $6::"PlanInterval", $7,
        $8::text[], true, $9, now())
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       "billingType" = EXCLUDED."billingType",
       interval = EXCLUDED.interval,
       "basePrice" = EXCLUDED."basePrice",
       features = EXCLUDED.features,
       "sortOrder" = EXCLUDED."sortOrder",
       "updatedAt" = now()
     RETURNING id`,
    [
      randomUUID(),
      plan.name,
      plan.slug,
      plan.description,
      plan.billingType,
      plan.interval,
      plan.basePrice,
      plan.features,
      plan.sortOrder,
    ],
  );
  return rows[0].id;
}

// Upsert the single global pricing config and rewrite its area tier ladder.
async function seedPricingConfig(client) {
  await client.query(
    `INSERT INTO "pricing_config" (id, "maxAreaSqFt", "updatedAt")
     VALUES ('singleton', $1, now())
     ON CONFLICT (id) DO UPDATE SET
       "maxAreaSqFt" = EXCLUDED."maxAreaSqFt",
       "updatedAt" = now()`,
    [MAX_AREA_SQFT],
  );
  await client.query(`DELETE FROM "area_tier" WHERE "configId" = 'singleton'`);
  for (const tier of AREA_TIERS) {
    await client.query(
      `INSERT INTO "area_tier" (id, "configId", "minSqFt", "maxSqFt", surcharge)
       VALUES ($1, 'singleton', $2, $3, $4)`,
      [randomUUID(), tier.minSqFt, tier.maxSqFt, tier.surcharge],
    );
  }
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const plan of PLANS) {
      await upsertPlan(client, plan);
      console.log(`  ✔ ${plan.name} (${plan.slug}) — $${(plan.basePrice / 100).toFixed(2)} base`);
    }
    await seedPricingConfig(client);
    console.log(
      `\n✔ Seeded ${PLANS.length} plans + global pricing config (${AREA_TIERS.length} area tiers).\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\n✖ Seed failed: ${err?.message || String(err)}\n`);
  process.exit(1);
});
