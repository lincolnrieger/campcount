/**
 * Name search used across CampCount. One letter finds everyone whose first
 * or last name starts with it ("L" finds Lily and Lee); longer text matches
 * anywhere in the full name, or a membership number or code.
 */
export function matchesSearch(query: string, fullName: string, ...extra: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = fullName.toLowerCase();
  const words = name.split(/[\s'-]+/).filter(Boolean);
  if (q.length === 1) return words.some((w) => w.startsWith(q));
  if (name.includes(q) || words.some((w) => w.startsWith(q))) return true;
  return extra.some((e) => e && e.toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, '')));
}

/** Sort so people whose first name starts with the query come first, then last names, then the rest. */
export function searchRank(query: string, fullName: string): number {
  const q = query.trim().toLowerCase();
  const [first = '', ...rest] = fullName.toLowerCase().split(/\s+/);
  if (first.startsWith(q)) return 0;
  if (rest.some((w) => w.startsWith(q))) return 1;
  return 2;
}
