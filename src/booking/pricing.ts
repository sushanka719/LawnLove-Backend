// Mirror of LawnFrontend/lib/pricing.ts — the server recomputes the amount from
// the stored plan + server-computed area on every booking, so client-sent prices
// are never trusted. All money is in CENTS. Keep this in sync with the frontend.

// The measured polygon is slightly larger than the mowable area; scale it down
// to an "estimated" mowable area used for the surcharge lookup.
export const ESTIMATED_AREA_FACTOR = 0.95;

export type AreaTier = {
  minSqFt: number;
  maxSqFt: number | null; // null = open-ended top bracket
  surcharge: number; // cents
};

export type PlanForQuote = {
  basePrice: number; // cents
  areaTiers: AreaTier[];
};

// Surcharge (cents) for the bracket the area falls into. Brackets are treated as
// half-open [minSqFt, maxSqFt); the top tier has maxSqFt === null (no upper
// bound). Returns 0 when the area is below the first bracket's minSqFt.
export function surchargeForArea(tiers: AreaTier[], areaSqFt: number): number {
  const match = [...tiers]
    .sort((a, b) => a.minSqFt - b.minSqFt)
    .find(
      (t) =>
        areaSqFt >= t.minSqFt && (t.maxSqFt == null || areaSqFt < t.maxSqFt),
    );
  return match ? match.surcharge : 0;
}

// Final per-visit quote (cents): plan base price + the area surcharge bracket.
export function computeQuote(plan: PlanForQuote, estimatedAreaSqFt: number) {
  const basePrice = plan.basePrice;
  const areaSurcharge = surchargeForArea(plan.areaTiers, estimatedAreaSqFt);
  return { basePrice, areaSurcharge, totalPerVisit: basePrice + areaSurcharge };
}
