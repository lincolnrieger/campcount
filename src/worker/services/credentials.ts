import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '../../shared/credentials';
import type { Env } from '../env';
import { decryptString, encryptString, randomInt, randomToken, sha256Hex } from '../lib/crypto';
import { nowIso } from '../lib/time';

const PURPOSE = 'campcount/credential-token/v1';

export function randomShortCode(): string {
  let out = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  return out;
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(`credential:${token}`);
}

/**
 * Statements that issue a fresh credential for each registration, revoking any
 * active one. Short-code collisions within an event are retried by the caller
 * (the UNIQUE constraint makes them fail loudly, never silently).
 */
export async function issueStatements(env: Env, eventId: string, registrationIds: string[]): Promise<D1PreparedStatement[]> {
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const registrationId of registrationIds) {
    const token = randomToken(16);
    statements.push(
      env.DB.prepare(
        `UPDATE credentials SET status = 'revoked', revoked_at = ? WHERE registration_id = ? AND status = 'active'`,
      ).bind(now, registrationId),
      env.DB.prepare(
        `INSERT INTO credentials (id, event_id, registration_id, token_hash, token_ciphertext, short_code, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        registrationId,
        await hashToken(token),
        await encryptString(env.AUTH_SECRET, PURPOSE, token),
        randomShortCode(),
        now,
      ),
    );
  }
  return statements;
}

export async function decryptToken(env: Env, ciphertext: string): Promise<string> {
  return decryptString(env.AUTH_SECRET, PURPOSE, ciphertext);
}
