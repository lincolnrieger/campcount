import type { ImportRow, PersonEntry } from '../../shared/schemas';
import type { LevelSetting } from '../../shared/levels';
import { kindForLevel, defaultLevel, linkLevels, normalizeLevel, withLevels } from '../../shared/levels';
import type { Env } from '../env';
import { randomInt } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { participantKey, seal } from '../lib/vault';
import { issueStatements } from './credentials';
import { loadLevels } from './levels';

/** The ways the database finds a person by participant ID: by keyed hash (and, until old rows are encrypted, by the ID itself). */
export const PERSON_BY_ID = `(SELECT id FROM people WHERE participant_key = ?)`;

/**
 * Statements that put one person on an event roster (or update them): the
 * person record, their registration and their dietary entries, with every
 * personal field encrypted. Imports update names; registration requests use
 * keepExistingNames so a typed participant ID can't rename someone.
 */
export async function rowStatements(
  env: Env,
  eventId: string,
  row: ImportRow,
  dietaryPending: boolean,
  now: string,
  userId: string,
  opts: { keepExistingNames?: boolean } = {},
): Promise<D1PreparedStatement[]> {
  const db = env.DB;
  const key = await participantKey(env, row.participantId);
  const [pid, first, last, level, group] = await Promise.all([
    seal(env, row.participantId),
    seal(env, row.firstName),
    seal(env, row.lastName),
    seal(env, row.level),
    seal(env, row.groupName),
  ]);
  const statements: D1PreparedStatement[] = [
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
        `INSERT INTO registrations (id, event_id, person_id, kind, level, group_name, photo_consent, status,
            dietary_source_hash, dietary_review_pending, created_at, updated_at)
         VALUES (?, ?, ${PERSON_BY_ID}, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
         ON CONFLICT (event_id, person_id) DO UPDATE SET
           kind = excluded.kind, level = excluded.level, group_name = excluded.group_name,
           photo_consent = excluded.photo_consent, status = 'active',
           dietary_source_hash = CASE WHEN ? THEN registrations.dietary_source_hash ELSE excluded.dietary_source_hash END,
           dietary_review_pending = excluded.dietary_review_pending,
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        key,
        row.kind,
        level,
        group,
        row.photoConsent,
        // A brand-new registration with unreviewed dietary text starts with no fingerprint, so it stays flagged.
        dietaryPending ? null : row.dietaryFingerprint,
        dietaryPending ? 1 : 0,
        now,
        now,
        dietaryPending ? 1 : 0,
      ),
  ];
  if (row.dietary !== undefined) {
    const regRef = `(SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.participant_key = ?)`;
    statements.push(db.prepare(`DELETE FROM dietary_entries WHERE registration_id = ${regRef}`).bind(eventId, key));
    for (const d of row.dietary) statements.push(...(await dietaryInsert(env, eventId, regRef, [eventId, key], d, userId, now)));
  }
  return statements;
}

/** Insert one dietary entry, with the item and note encrypted. `regRef` is SQL for the registration id, bound with `refBinds`. */
export async function dietaryInsert(
  env: Env,
  eventId: string,
  regRef: string,
  refBinds: unknown[],
  d: { category: string; item: string; severity: string; note: string },
  userId: string,
  now: string,
): Promise<D1PreparedStatement[]> {
  return [
    env.DB.prepare(
      `INSERT INTO dietary_entries (id, event_id, registration_id, category, item, severity, note, created_by, created_at)
       VALUES (?, ?, ${regRef}, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), eventId, ...refBinds, d.category, await seal(env, d.item), d.severity, await seal(env, d.note), userId, now),
  ];
}

/**
 * Rows filed under the camp's levels: names matched to the camp's own,
 * empty ones to its first level, and youth or adult from the level. New
 * level names are added to the camp. Returns the rows and the camp's levels
 * (with any additions) and statements to save them.
 */
export async function fileUnderLevels(
  env: Env,
  eventId: string,
  rows: ImportRow[],
  links?: Record<string, string>,
): Promise<{ rows: ImportRow[]; levels: LevelSetting[]; save: D1PreparedStatement[] }> {
  const stored = await loadLevels(env.DB, eventId);
  // Names linked on the import screen ("Early Bird Youth" → Youth) are remembered on the level.
  const linked = links && Object.keys(links).length ? linkLevels(stored, links) : { levels: stored, changed: false };
  const before = linked.levels;
  const named = rows.map((r) => ({ ...r, level: r.level.trim() ? normalizeLevel(r.level, before) : '' }));
  const { levels, added } = withLevels(
    before,
    named.map((r) => r.level).filter(Boolean),
  );
  const filed = named.map((r) => {
    const level = r.level || defaultLevel(r.kind, levels);
    return { ...r, level, kind: kindForLevel(level, levels) };
  });
  const save = added.length || linked.changed ? [levelSettingsStatement(env.DB, eventId, levels)] : [];
  return { rows: filed, levels, save };
}

/** Save a camp's levels (and its youth list, kept in step). */
export function levelSettingsStatement(db: D1Database, eventId: string, levels: LevelSetting[]): D1PreparedStatement {
  return db
    .prepare(`UPDATE events SET level_settings = ?, youth_levels = ? WHERE id = ?`)
    .bind(JSON.stringify(levels), JSON.stringify(levels.filter((s) => s.youth).map((s) => s.name)), eventId);
}

/**
 * Youth or adult follows each person's level and the camp's levels. Run
 * after anything that changes levels or which ones count as youth. Levels
 * are encrypted, so this compares them here rather than in SQL.
 */
export async function syncKinds(env: Env, eventId: string): Promise<void> {
  const levels = await loadLevels(env.DB, eventId);
  const { results } = await env.DB.prepare(`SELECT id, level, kind FROM registrations WHERE event_id = ?`).bind(eventId).all<{ id: string; level: string; kind: string }>();
  const changes = results.filter((r) => kindForLevel(r.level, levels) !== r.kind);
  for (let i = 0; i < changes.length; i += 90) {
    await env.DB.batch(
      changes.slice(i, i + 90).map((r) => env.DB.prepare(`UPDATE registrations SET kind = ? WHERE id = ?`).bind(kindForLevel(r.level, levels), r.id)),
    );
  }
}

/** An ID for someone who doesn't have one. */
export function guestNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `GUEST-${Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('')}`;
}

export function toImportRow(p: PersonEntry & { participantId: string }): ImportRow {
  return {
    participantId: p.participantId,
    firstName: p.firstName,
    lastName: p.lastName,
    kind: p.kind,
    level: p.level,
    groupName: p.groupName,
    photoConsent: p.photoConsent,
    dietaryFingerprint: null,
    dietary: p.dietary,
  };
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
export async function addToRoster(env: Env, eventId: string, row: ImportRow, recordedBy: string, keepExistingNames: boolean): Promise<string> {
  const now = nowIso();
  const filed = await fileUnderLevels(env, eventId, [row]);
  await env.DB.batch([...filed.save, ...(await rowStatements(env, eventId, filed.rows[0]!, false, now, recordedBy, { keepExistingNames }))]);
  const regId = (await registrationIdFor(env, eventId, row.participantId))!;
  // Someone already on the roster keeps the card they may have printed.
  const hasCard = await env.DB.prepare(`SELECT 1 FROM credentials WHERE registration_id = ? AND status = 'active'`).bind(regId).first();
  if (!hasCard) await env.DB.batch(await issueStatements(env, eventId, [regId]));
  return regId;
}
