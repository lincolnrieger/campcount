import type { ImportRow, PersonEntry } from '../../shared/schemas';
import type { Env } from '../env';
import { randomInt } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { issueStatements } from './credentials';

/**
 * Statements that put one person on an event roster (or update them):
 * the person record, their registration and their dietary entries.
 * Imports update names from the source; registration requests use
 * keepExistingNames so a typed membership number can't rename someone.
 */
export function rowStatements(
  db: D1Database,
  eventId: string,
  row: ImportRow,
  dietaryPending: boolean,
  now: string,
  userId: string,
  opts: { keepExistingNames?: boolean } = {},
) {
  const personRef = `(SELECT id FROM people WHERE member_number = ?)`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO people (id, member_number, first_name, preferred_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ${
           opts.keepExistingNames
             ? 'ON CONFLICT (member_number) DO NOTHING'
             : `ON CONFLICT (member_number) DO UPDATE SET
           first_name = excluded.first_name, preferred_name = excluded.preferred_name,
           last_name = excluded.last_name, updated_at = excluded.updated_at
         WHERE first_name <> excluded.first_name OR preferred_name <> excluded.preferred_name OR last_name <> excluded.last_name`
         }`,
      )
      .bind(crypto.randomUUID(), row.memberNumber, row.firstName, row.preferredName, row.lastName, now, now),
    db
      .prepare(
        `INSERT INTO registrations (id, event_id, person_id, kind, section, group_name, position, role_label, team,
            source_status, photo_consent, status, dietary_source_hash, dietary_review_pending, created_at, updated_at)
         VALUES (?, ?, ${personRef}, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
         ON CONFLICT (event_id, person_id) DO UPDATE SET
           kind = excluded.kind, section = excluded.section, group_name = excluded.group_name,
           position = excluded.position, role_label = excluded.role_label, team = excluded.team,
           source_status = excluded.source_status, photo_consent = excluded.photo_consent, status = 'active',
           dietary_source_hash = CASE WHEN ? THEN registrations.dietary_source_hash ELSE excluded.dietary_source_hash END,
           dietary_review_pending = excluded.dietary_review_pending,
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        row.memberNumber,
        row.kind,
        row.section,
        row.groupName,
        row.position,
        row.roleLabel,
        row.team,
        row.sourceStatus,
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
    const regRef = `(SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ?)`;
    statements.push(db.prepare(`DELETE FROM dietary_entries WHERE registration_id = ${regRef}`).bind(eventId, row.memberNumber));
    for (const d of row.dietary) {
      statements.push(
        db
          .prepare(
            `INSERT INTO dietary_entries (id, event_id, registration_id, category, item, severity, note, created_by, created_at)
             VALUES (?, ?, ${regRef}, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), eventId, eventId, row.memberNumber, d.category, d.item, d.severity, d.note, userId, now),
      );
    }
  }
  return statements;
}

/** A guest number for people who aren't Scouts members. */
export function guestNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `GUEST-${Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('')}`;
}

export function toImportRow(p: PersonEntry & { memberNumber: string }): ImportRow {
  return {
    memberNumber: p.memberNumber,
    firstName: p.firstName,
    preferredName: p.preferredName,
    lastName: p.lastName,
    kind: p.kind,
    section: p.kind === 'adult' ? 'Leaders' : p.section,
    groupName: p.groupName,
    position: p.kind === 'adult' ? p.position || 'Leader' : `${p.section.replace(/s$/, '')} member`,
    roleLabel: p.kind === 'adult' ? 'Leader' : 'Participant',
    team: '',
    sourceStatus: 'Registered on CampCount',
    photoConsent: p.photoConsent,
    dietaryFingerprint: null,
    dietary: p.dietary,
  };
}

/**
 * Put one person on the roster with a lanyard card, returning their
 * registration id. Existing members keep the names already on file.
 */
export async function addToRoster(env: Env, eventId: string, row: ImportRow, recordedBy: string, keepExistingNames: boolean): Promise<string> {
  const now = nowIso();
  await env.DB.batch(rowStatements(env.DB, eventId, row, false, now, recordedBy, { keepExistingNames }));
  const reg = await env.DB.prepare(
    `SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ?`,
  )
    .bind(eventId, row.memberNumber)
    .first<{ id: string }>();
  // Someone already on the roster keeps the card they may have printed.
  const hasCard = await env.DB.prepare(`SELECT 1 FROM credentials WHERE registration_id = ? AND status = 'active'`).bind(reg!.id).first();
  if (!hasCard) await env.DB.batch(await issueStatements(env, eventId, [reg!.id]));
  return reg!.id;
}
