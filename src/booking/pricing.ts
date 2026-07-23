// Mirror of LawnFrontend/lib/pricing.ts — the server recomputes the amount from
// the plan's base price + the GLOBAL area surcharge ladder + server-computed
// area on every booking, so client-sent prices are never trusted. All money is
// in CENTS. The tier ladder and maximum area live in the global PricingConfig
// (see PricingSettingsService), not on the plan. Keep this in sync with the
// frontend.

// The measured polygon is slightly larger than the mowable area; scale it down
// to an "estimated" mowable area used for the surcharge lookup.
export const ESTIMATED_AREA_FACTOR = 0.95;

export type AreaTier = {
  minSqFt: number;
  maxSqFt: number | null; // null = open-ended top bracket
  surcharge: number; // cents
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

// Whether a lawn is larger than the business will service. maxAreaSqFt === null
// means "no maximum" — nothing is ever rejected for size.
export function isOverMaxArea(
  maxAreaSqFt: number | null,
  areaSqFt: number,
): boolean {
  return maxAreaSqFt != null && areaSqFt > maxAreaSqFt;
}

// Final per-visit quote (cents): plan base price + the global area surcharge
// bracket for the measured area.
export function computeQuote(
  basePrice: number,
  tiers: AreaTier[],
  estimatedAreaSqFt: number,
) {
  const areaSurcharge = surchargeForArea(tiers, estimatedAreaSqFt);
  return { basePrice, areaSurcharge, totalPerVisit: basePrice + areaSurcharge };
}
