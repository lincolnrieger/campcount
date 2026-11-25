import type { PersonEntry, RosterRow } from '../../shared/schemas';
import type { Env } from '../env';
import { randomInt } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { participantKey, seal } from '../lib/vault';
import { issueStatements } from './credentials';

/** Finds a person by participant ID, through its keyed hash (the ID itself is encrypted). */
export const PERSON_BY_ID = `(SELECT id FROM people WHERE participant_key = ?)`;

/**
 * Statements that put one person on an event roster (or update them). Only
 * their name, participant ID (both encrypted) and role are stored.
 * keepExistingNames: a typed participant ID can't rename someone.
 */
export async function rowStatements(env: Env, eventId: string, row: RosterRow, now: string, opts: { keepExistingNames?: boolean } = {}): Promise<D1PreparedStatement[]> {
  const db = env.DB;
  const key = await participantKey(env, row.participantId);
  const [pid, first, last] = await Promise.all([seal(env, row.participantId), seal(env, row.firstName), seal(env, row.lastName)]);
  return [
    db
      .prepare(
        `INSERT INTO people (id, participant_id, participant_key, first_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ${
           opts.keepExistingNames
             ? 'ON CONFLICT (participant_key) WHERE participant_key IS NOT NULL DO NOTHING'
             : `ON CONFLICT (participant_key) WHERE participant_key IS NOT NULL DO UPDATE SET
           first_name = excluded.first_name, last_name = excluded.last_name, updated_at = excluded.updated_at`
         }`,
      )
      .bind(crypto.randomUUID(), pid, key, first, last, now, now),
    db
      .prepare(
        `INSERT INTO registrations (id, event_id, person_id, kind, status, created_at, updated_at)
         VALUES (?, ?, ${PERSON_BY_ID}, ?, 'active', ?, ?)
         ON CONFLICT (event_id, person_id) DO UPDATE SET kind = excluded.kind, status = 'active', updated_at = excluded.updated_at`,
      )
      .bind(crypto.randomUUID(), eventId, key, row.kind, now, now),
  ];
}

/** An ID for someone who doesn't have one. */
export function guestNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `GUEST-${Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('')}`;
}

export function toRosterRow(p: PersonEntry & { participantId: string }): RosterRow {
  return { participantId: p.participantId, firstName: p.firstName, lastName: p.lastName, kind: p.kind };
}

/** The registration id of someone on an event, found by participant ID. */
export async function registrationIdFor(env: Env, eventId: string, participantId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.participant_key = ?`)
    .bind(eventId, await participantKey(env, participantId))
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Put one person on the roster with a lanyard card, returning their
 * registration id. Existing people keep the names already on file.
 */
export async function addToRoster(env: Env, eventId: string, row: RosterRow, keepExistingNames: boolean): Promise<string> {
  await env.DB.batch(await rowStatements(env, eventId, row, nowIso(), { keepExistingNames }));
  const regId = (await registrationIdFor(env, eventId, row.participantId))!;
  // Someone already on the roster keeps the card they may have printed.
  const hasCard = await env.DB.prepare(`SELECT 1 FROM credentials WHERE registration_id = ? AND status = 'active'`).bind(regId).first();
  if (!hasCard) await env.DB.batch(await issueStatements(env, eventId, [regId]));
  return regId;
}
