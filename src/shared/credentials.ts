/** Manual-entry code alphabet: no 0/O, 1/I/L or U, to avoid misreads. */
export const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_CODE_LENGTH = 8;

export function formatShortCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalise what someone typed: uppercase, strip spaces and dashes. */
export function normaliseShortCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isShortCode(code: string): boolean {
  if (code.length !== SHORT_CODE_LENGTH) return false;
  for (const ch of code) if (!SHORT_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** QR payload. The token sits in the fragment so it never reaches a server log if opened as a link. */
export function credentialUrl(origin: string, token: string): string {
  return `${origin}/c#${token}`;
}

/** Extract the token from a scanned QR payload (URL form or bare token). */
export function parseCredentialPayload(payload: string): string | null {
  const text = payload.trim();
  const match = /^(?:https?:\/\/[^/#]+\/c#)?([A-Za-z0-9_-]{22})$/.exec(text);
  return match ? match[1]! : null;
}
