/** "Sam T." — preferred first name and last initial, as shown on scanners and lanyards. */
export function displayName(first: string, preferred: string, last: string): string {
  return `${preferred || first} ${last.slice(0, 1)}`.trim() + (last ? '.' : '');
}
