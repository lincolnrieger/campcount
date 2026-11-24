/** "Sam T." — first name and last initial, as shown on scanners and lanyards. */
export function displayName(first: string, last: string): string {
  const l = last.trim();
  return `${first.trim()} ${l ? `${l.charAt(0)}.` : ''}`.trim();
}
