import type { ImportRow, PersonEntry } from '../../shared/schemas';
import type { Env } from '../env';
import { hmacHex, randomInt, timingSafeEqualHex } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { todayInZone } from '../../shared/time';
import { auditStatement } from './audit';
import type { AuditActor } from './audit';
import { issueStatements } from './credentials';
import { sendEmail } from './email';
import { rowStatements } from './rosterWrites';

export interface RegistrationEvent {
  id: string;
  name: string;
  status: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  location: string;
  description: string;
  created_by: string;
  feature_dietary: number;
  feature_photo: number;
  registration_code: string | null;
  registration_open: number;
  registration_auto_approve: number;
  registration_closes_on: string | null;
  registration_limit: number | null;
}

export const EVENT_COLUMNS = `id, name, status, timezone, starts_on, ends_on, location, description, created_by, feature_dietary, feature_photo,
  registration_code, registration_open, registration_auto_approve, registration_closes_on, registration_limit`;

/** People on the roster plus requests still waiting: what counts towards the limit. */
export async function expectedCount(env: Env, eventId: string): Promise<{ registered: number; waiting: number }> {
  const row = await env.DB.prepare(
    `SELECT (SELECT count(*) FROM registrations WHERE event_id = ?1 AND status = 'active') AS registered,
            (SELECT count(*) FROM registration_requests WHERE event_id = ?1 AND status = 'pending') AS waiting`,
  )
    .bind(eventId)
    .first<{ registered: number; waiting: number }>();
  return { registered: row?.registered ?? 0, waiting: row?.waiting ?? 0 };
}

export type ClosedReason = 'not_open' | 'closed' | 'full' | 'event_over';

/** Why the page isn't taking registrations right now, or null if it is. */
export async function closedReason(env: Env, e: RegistrationEvent): Promise<ClosedReason | null> {
  if (!e.registration_open) return 'not_open';
  if (e.status !== 'draft' && e.status !== 'open') return 'event_over';
  const today = todayInZone(e.timezone);
  if (today > e.ends_on) return 'event_over';
  if (e.registration_closes_on && today > e.registration_closes_on) return 'closed';
  if (e.registration_limit) {
    const { registered, waiting } = await expectedCount(env, e.id);
    if (registered + waiting >= e.registration_limit) return 'full';
  }
  return null;
}

/** A guest number for people who aren't Scouts members. */
export function guestNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `GUEST-${Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('')}`;
}

/**
 * After someone confirms their email, the page keeps this token for an hour so
 * a parent can register several children without a new code each time.
 */
export async function contactToken(env: Env, eventId: string, email: string, expires = Date.now() + 3_600_000): Promise<string> {
  return `${expires}.${await hmacHex(env.AUTH_SECRET, `contact:${eventId}:${email}:${expires}`)}`;
}

export async function contactTokenValid(env: Env, eventId: string, email: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return timingSafeEqualHex(mac, await hmacHex(env.AUTH_SECRET, `contact:${eventId}:${email}:${expires}`));
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

interface RequestRow {
  id: string;
  event_id: string;
  member_number: string;
  first_name: string;
  preferred_name: string;
  last_name: string;
  kind: 'youth' | 'adult';
  section: string;
  group_name: string;
  position: string;
  photo_consent: 'yes' | 'no' | 'unknown';
  dietary: string;
  contact_email: string;
}

/** Approve a request: they join the roster with a card, and the contact is told. */
export async function approveRequest(env: Env, e: RegistrationEvent, requestId: string, actor: AuditActor): Promise<string | null> {
  const req = await env.DB.prepare(`SELECT * FROM registration_requests WHERE id = ? AND event_id = ? AND status = 'pending'`)
    .bind(requestId, e.id)
    .first<RequestRow>();
  if (!req) return null;
  const row = toImportRow({
    memberNumber: req.member_number,
    firstName: req.first_name,
    preferredName: req.preferred_name,
    lastName: req.last_name,
    kind: req.kind,
    section: req.section as PersonEntry['section'],
    groupName: req.group_name,
    position: req.position,
    photoConsent: req.photo_consent,
    dietary: JSON.parse(req.dietary) as PersonEntry['dietary'],
  });
  const recordedBy = actor.type === 'user' ? actor.id : e.created_by;
  const registrationId = await addToRoster(env, e.id, row, recordedBy, true);
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE registration_requests SET status = 'approved', registration_id = ?, decided_by = ?, decided_at = ?, code_hash = NULL WHERE id = ?`,
    ).bind(registrationId, actor.type === 'user' ? actor.id : null, now, requestId),
    auditStatement(env.DB, { actor, action: 'registration.approve', eventId: e.id, targetType: 'registration', targetId: registrationId }),
  ]);
  const name = `${req.preferred_name || req.first_name} ${req.last_name}`;
  await sendEmail(env, {
    to: req.contact_email,
    subject: `${name} is registered for ${e.name}`,
    text: `${name} is registered for ${e.name} (${e.starts_on} to ${e.ends_on}${e.location ? `, ${e.location}` : ''}).\n\nTheir lanyard will be ready at camp. If anything changes, contact the event team.`,
  }).catch(() => console.error('Registration confirmation email could not be sent.'));
  return registrationId;
}

export const codeHash = (env: Env, requestId: string, code: string) => hmacHex(env.AUTH_SECRET, `register:${requestId}:${code}`);
