import { base64Url, hmacHex, timingSafeEqualHex } from './crypto';

/**
 * Password hashing: PBKDF2-SHA256 (100,000 iterations, the Workers maximum)
 * with a random per-user salt, then an HMAC with the server secret as a
 * pepper. A stolen database alone is not enough to start guessing passwords.
 *
 * Stored format: pbkdf2$<iterations>$<salt b64url>$<hex>
 */
const ITERATIONS = 100_000;
const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return base64Url(new Uint8Array(bits));
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export async function hashPassword(secret: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${base64Url(salt)}$${await hmacHex(secret, derived)}`;
}

export async function verifyPassword(secret: string, password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, expected] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false;
  const derived = await derive(password, fromBase64Url(salt), Number(iterations));
  return timingSafeEqualHex(await hmacHex(secret, derived), expected);
}

/** Burn the same time as a real check, so unknown emails can't be told apart by timing. */
export async function dummyVerify(secret: string, password: string): Promise<void> {
  await verifyPassword(secret, password, `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$${'0'.repeat(64)}`);
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Human-readable reason a password is unacceptable, or null if it's fine. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) return "Don't use your email address in your password.";
  if (/^(.)\1+$/.test(password)) return 'Choose something less predictable.';
  const common = ['password', 'campcount', 'scouts', 'qwerty', '1234567890', 'letmein'];
  if (common.some((w) => password.toLowerCase().includes(w))) return 'That password is too easy to guess.';
  return null;
}
