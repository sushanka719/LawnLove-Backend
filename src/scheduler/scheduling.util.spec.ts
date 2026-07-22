import { addInterval, addUtcDays, startOfUtcDay } from './scheduling.util';

describe('scheduling.util', () => {
  describe('startOfUtcDay', () => {
    it('strips the time-of-day, staying in UTC', () => {
      const d = new Date('2026-07-22T18:45:12.500Z');
      expect(startOfUtcDay(d).toISOString()).toBe('2026-07-22T00:00:00.000Z');
    });

    it('does not roll into the next day for late-UTC times', () => {
      const d = new Date('2026-07-22T23:59:59.999Z');
      expect(startOfUtcDay(d).toISOString()).toBe('2026-07-22T00:00:00.000Z');
    });
  });

  describe('addUtcDays', () => {
    it('adds and subtracts whole days across a month boundary', () => {
      const d = new Date('2026-07-30T00:00:00.000Z');
      expect(addUtcDays(d, 3).toISOString()).toBe('2026-08-02T00:00:00.000Z');
      expect(addUtcDays(d, -31).toISOString()).toBe('2026-06-29T00:00:00.000Z');
    });
  });

  describe('addInterval', () => {
    const anchor = new Date('2026-07-22T00:00:00.000Z');

    it('weekly = +7 days', () => {
      expect(addInterval(anchor, 'weekly').toISOString()).toBe(
        '2026-07-29T00:00:00.000Z',
      );
    });

    it('biweekly = +14 days', () => {
      expect(addInterval(anchor, 'biweekly').toISOString()).toBe(
        '2026-08-05T00:00:00.000Z',
      );
    });

    it('monthly = +1 calendar month', () => {
      expect(addInterval(anchor, 'monthly').toISOString()).toBe(
        '2026-08-22T00:00:00.000Z',
      );
    });

    it('monthly rolls a short-month overflow into the following month', () => {
      // Jan 31 + 1 month has no Feb 31 — JS rolls it to early March.
      const jan31 = new Date('2026-01-31T00:00:00.000Z');
      expect(addInterval(jan31, 'monthly').toISOString()).toBe(
        '2026-03-03T00:00:00.000Z',
      );
    });

    it('normalizes a time-carrying date to midnight UTC', () => {
      const messy = new Date('2026-07-22T09:30:00.000Z');
      expect(addInterval(messy, 'weekly').toISOString()).toBe(
        '2026-07-29T00:00:00.000Z',
      );
    });
  });
});
