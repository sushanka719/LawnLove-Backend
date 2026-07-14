// Mirror of LawnFrontend/lib/pricing.ts — the server recomputes all totals from
// the (server-computed) area + chosen frequency so client-sent prices are never
// trusted. Keep these constants in sync with the frontend.
export const RATE_PER_SQFT = 0.0123;
export const MIN_PRICE = 40;
export const ESTIMATED_AREA_FACTOR = 0.95;

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'oneTime';

export const FREQUENCY_DISCOUNTS: Record<Frequency, number> = {
  weekly: 0.15,
  biweekly: 0.1,
  monthly: 0.05,
  oneTime: 0,
};

export function computeBasePrice(areaSqFt: number): number {
  return Math.max(MIN_PRICE, Math.round(areaSqFt * RATE_PER_SQFT));
}

export function computeQuote(areaSqFt: number, frequency: Frequency) {
  const subtotal = computeBasePrice(areaSqFt);
  const discountPct = FREQUENCY_DISCOUNTS[frequency];
  const totalPerVisit = Math.round(subtotal * (1 - discountPct));
  return { subtotal, discountPct, totalPerVisit };
}
