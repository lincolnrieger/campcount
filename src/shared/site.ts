/** Rules for an event's own address and branding, shared by the browser and the server. */

/** Addresses that can never belong to an event. */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'admin', 'app', 'apps', 'mail', 'email', 'smtp', 'campcount', 'staging', 'stage', 'dev', 'test', 'demo',
  'static', 'assets', 'cdn', 'help', 'support', 'status', 'docs', 'blog', 'login', 'signin', 'auth', 'account', 'accounts',
]);

export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** "Summer Camp 2026!" → "summer-camp-2026" (a suggestion; the admin can change it). */
export function suggestSubdomain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function subdomainProblem(value: string): string | null {
  if (!SUBDOMAIN_PATTERN.test(value)) return 'Use 3 to 40 lowercase letters, numbers and hyphens, starting and ending with a letter or number';
  if (RESERVED_SUBDOMAINS.has(value)) return 'That address is reserved. Choose another';
  return null;
}

export const BRAND_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_BRAND = '#1F5C46';

function luminance(hex: string): number {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function mix(hex: string, toward: number, amount: number): string {
  return (
    '#' +
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .map((c) => Math.round(c + (toward - c) * amount))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * A brand colour that white text can sit on (at least 4.5:1). Light colours
 * are darkened until they pass, so any colour an admin picks stays readable.
 */
export function accessibleBrand(hex: string | null | undefined): string {
  let c = hex && BRAND_COLOR_PATTERN.test(hex) ? hex.toLowerCase() : DEFAULT_BRAND.toLowerCase();
  for (let i = 0; i < 40 && contrast(c, '#ffffff') < 4.6; i++) c = mix(c, 0, 0.06);
  return c;
}

/** The darker hover shade and the pale tint used for selected states. */
export function brandShades(hex: string) {
  const brand = accessibleBrand(hex);
  return { brand, hover: mix(brand, 0, 0.2), tint: mix(brand, 255, 0.9) };
}
