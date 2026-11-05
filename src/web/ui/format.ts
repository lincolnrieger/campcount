const dateFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "14 Dec 2026" or "14 Dec 2026 to 18 Dec 2026". */
export function formatDateRange(startsOn: string, endsOn: string): string {
  const a = dateFormat.format(new Date(`${startsOn}T00:00:00Z`));
  if (startsOn === endsOn) return a;
  return `${a} to ${dateFormat.format(new Date(`${endsOn}T00:00:00Z`))}`;
}

/** "Sat 14 Dec" for a YYYY-MM-DD day. */
export function formatDay(day: string): string {
  return shortDate.format(new Date(`${day}T00:00:00Z`));
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
