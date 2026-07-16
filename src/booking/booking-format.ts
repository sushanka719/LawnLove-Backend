import { BookingFrequency } from '../../generated/prisma/client';

const FREQUENCY_LABELS: Record<BookingFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  oneTime: 'One-time',
};

// Human-facing booking reference. Mirrors the frontend confirmation convention
// (`LL-${id.slice(-6).toUpperCase()}`) so the same code shows the same id.
export function bookingReference(id: string): string {
  return `LL-${id.slice(-6).toUpperCase()}`;
}

// Bookings have no explicit service name (the app only sells lawn mowing), so a
// display title is derived from the cadence, e.g. "Weekly Lawn Mowing".
export function bookingServiceLabel(frequency: BookingFrequency): string {
  return `${FREQUENCY_LABELS[frequency]} Lawn Mowing`;
}
