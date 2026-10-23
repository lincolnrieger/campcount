export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function addDays(iso: string, days: number): string {
  return addMinutes(iso, days * 24 * 60);
}
