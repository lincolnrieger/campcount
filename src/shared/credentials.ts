/** Manual-entry code alphabet: no 0/O, 1/I/L or U, to avoid misreads. */
export const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_CODE_LENGTH = 8;

/** Show a code: random codes as K7QM-3XRP; participant IDs as they are. */
export function formatShortCode(code: string): string {
  return isShortCode(code) && /[A-Z]/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * The typed code on someone's lanyard: their participant ID, normalised.
 * Null for people without one (they get a random code instead).
 */
export function memberCardCode(participantId: string | null | undefined): string | null {
  if (!participantId || /^GUEST-/i.test(participantId)) return null;
  const code = normaliseShortCode(participantId);
  return /^[A-Z0-9]{3,20}$/.test(code) ? code : null;
}

/** Could this be a lanyard code someone typed (a participant ID or a random code)? */
export function isTypedCode(code: string): boolean {
  return /^[A-Z0-9]{3,20}$/.test(code);
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
