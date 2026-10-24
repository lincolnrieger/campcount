import { describe, expect, it } from 'vitest';
import { dayInZone, dayLabel, eventDays, inferDay, timeInZone, zonedIso } from '../src/shared/time';

const TZ = 'Australia/Adelaide';

describe('event-local time', () => {
  it('builds ISO times with the right offset, including daylight saving', () => {
    expect(zonedIso('2026-12-05', '18:00', TZ)).toBe('2026-12-05T18:00:00+10:30');
    expect(zonedIso('2026-07-04', '07:30', TZ)).toBe('2026-07-04T07:30:00+09:30');
  });

  it('round-trips a time to its local day and clock', () => {
    const iso = zonedIso('2026-12-05', '07:30', TZ);
    expect(dayInZone(iso, TZ)).toBe('2026-12-05'); // 21:00 UTC the day before
    expect(timeInZone(iso, TZ)).toMatch(/7:30\sam/);
  });

  it('lists event days and labels them', () => {
    expect(eventDays('2026-12-04', '2026-12-06')).toEqual(['2026-12-04', '2026-12-05', '2026-12-06']);
    expect(dayLabel('2026-12-05')).toBe('Sat 5');
  });

  it('finds the day for older meals named after a weekday', () => {
    const days = eventDays('2026-12-04', '2026-12-06');
    expect(inferDay('Saturday lunch', days)).toBe('2026-12-05');
    expect(inferDay('Sun brekky', days)).toBe('2026-12-06');
    expect(inferDay('Morning tea', days)).toBeNull();
  });
});
