// Pure date helpers for the scheduler. Every visit date is stored at midnight
// UTC (booking.scheduleDate is created as `${date}T00:00:00.000Z`), so all math
// here stays in UTC to avoid timezone drift.

// Recurring cadences. Mirrors PlanInterval / the non-oneTime BookingFrequency.
export type RecurringInterval = 'weekly' | 'biweekly' | 'monthly';

// Midnight UTC on the same calendar day as `d`.
export function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

// `d` shifted by `n` whole days (n may be negative), preserving the UTC clock.
export function addUtcDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

// The date one interval after `d` (weekly = +7d, biweekly = +14d, monthly =
// +1 calendar month). Result is normalized to midnight UTC. Used to roll the
// window forward from the latest existing visit (scheduler §5.2).
export function addInterval(d: Date, interval: RecurringInterval): Date {
  const base = startOfUtcDay(d);
  switch (interval) {
    case 'weekly':
      return addUtcDays(base, 7);
    case 'biweekly':
      return addUtcDays(base, 14);
    case 'monthly': {
      const out = new Date(base);
      out.setUTCMonth(out.getUTCMonth() + 1);
      return out;
    }
  }
}
