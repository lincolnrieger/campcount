/**
 * Names are encrypted in the database, so lists are sorted here, after
 * they're decrypted, instead of with ORDER BY.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export const compareText = (a: string | null | undefined, b: string | null | undefined) => collator.compare(a ?? '', b ?? '');

/** Sort rows by last name, then first name (case-insensitive). Sorts in place and returns the array. */
export function sortByName<T extends { first_name?: unknown; last_name?: unknown }>(rows: T[]): T[] {
  return rows.sort((a, b) => compareText(String(a.last_name ?? ''), String(b.last_name ?? '')) || compareText(String(a.first_name ?? ''), String(b.first_name ?? '')));
}
