/**
 * Calendar helpers for event-local days. Events run in one IANA timezone
 * (Australia/Adelaide by default); meals and activities are grouped by the
 * day they fall on there, whatever timezone the phone is set to.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** "2026-12-05" + "18:00" in Australia/Adelaide → "2026-12-05T18:00:00+10:30". */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const guess = offsetMinutes(naive, timeZone);
  const off = offsetMinutes(naive - guess * 60_000, timeZone);
  const abs = Math.abs(off);
  return `${date}T${time}:00${off < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The event-local calendar day (YYYY-MM-DD) of an instant. */
export function dayInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Event-local clock time of an instant, e.g. "6:00 pm". */
export function timeInZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone });
}

/** "9:00 am to 10:30 am", "From 9:00 am", or "" when there is no set time. */
export function timeRange(startsAt: string | null, endsAt: string | null, timeZone: string): string {
  if (!startsAt) return '';
  return endsAt ? `${timeInZone(startsAt, timeZone)} to ${timeInZone(endsAt, timeZone)}` : `From ${timeInZone(startsAt, timeZone)}`;
}

/** "HH:MM" of an instant in the event timezone, for time inputs. */
export function clockInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** Every calendar day from startsOn to endsOn inclusive (capped at 31). */
export function eventDays(startsOn: string, endsOn: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${startsOn}T00:00:00Z`); t <= Date.parse(`${endsOn}T00:00:00Z`) && days.length < 31; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** "Sat 6" (short) or "Saturday 6 December" (long). */
export function dayLabel(day: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${day}T00:00:00Z`);
  return style === 'short'
    ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function weekdayName(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
}

/** For meals without a time: "Saturday lunch" → the event's Saturday, if there is exactly one. */
export function inferDay(name: string, days: string[]): string | null {
  const lower = name.toLowerCase();
  const hits = days.filter((d) => lower.includes(weekdayName(d).toLowerCase()) || new RegExp(`\\b${weekdayName(d).slice(0, 3).toLowerCase()}\\b`).test(lower));
  return hits.length === 1 ? hits[0]! : null;
}

/** Today in the event timezone. */
export function todayInZone(timeZone: string): string {
  return dayInZone(new Date().toISOString(), timeZone);
}
