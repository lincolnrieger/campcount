import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH, memberCardCode } from '../../shared/credentials';
import type { Env } from '../env';
import { decryptString, encryptString, randomInt, randomToken, sha256Hex } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { seal, shortCodeKey } from '../lib/vault';

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
  // The typed code is the person's participant ID; people without one get a random code.
  const members = new Map<string, string>();
  for (let i = 0; i < registrationIds.length; i += 90) {
    const chunk = registrationIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT r.id, p.participant_id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.id IN (${chunk.map(() => '?').join(', ')})`,
    )
      .bind(...chunk)
      .all<{ id: string; participant_id: string }>();
    for (const r of results) members.set(r.id, r.participant_id);
  }
  for (const registrationId of registrationIds) {
    const token = randomToken(16);
    const code = memberCardCode(members.get(registrationId)) ?? randomShortCode();
    statements.push(
      // The old card stops working, and its typed code is retired so the new card can carry the same participant ID.
      env.DB.prepare(
        `UPDATE credentials SET status = 'revoked', revoked_at = ?,
            short_code = short_code || '~' || substr(id, 1, 8), short_code_key = short_code_key || '~' || substr(id, 1, 8)
          WHERE registration_id = ? AND status = 'active'`,
      ).bind(now, registrationId),
      env.DB.prepare(
        `INSERT INTO credentials (id, event_id, registration_id, token_hash, token_ciphertext, short_code, short_code_key, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        registrationId,
        await hashToken(token),
        await encryptString(env.AUTH_SECRET, PURPOSE, token),
        await seal(env, code),
        await shortCodeKey(env, code),
        now,
      ),
    );
  }
  return statements;
}

export async function decryptToken(env: Env, ciphertext: string): Promise<string> {
  return decryptString(env.AUTH_SECRET, PURPOSE, ciphertext);
}
