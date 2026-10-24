import type { Permission } from '../../shared/permissions';
import type { Env } from '../env';
import { randomToken, sha256Hex } from '../lib/crypto';
import { addDays, addMinutes, nowIso } from '../lib/time';
import type { AssignmentGrant, Principal, UserPrincipal } from './principal';

export const SESSION_COOKIE = '__Host-cc_session';
export const USER_SESSION_DAYS = 7;
export const USER_IDLE_HOURS = 12;
const TOUCH_INTERVAL_MINUTES = 5;

export async function createSession(
  env: Env,
  owner: { userId: string } | { stationId: string; expiresAt: string },
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const now = nowIso();
  const expiresAt =
    'userId' in owner ? addDays(now, USER_SESSION_DAYS) : owner.expiresAt;
  await env.DB.prepare(
    `INSERT INTO sessions (id_hash, user_id, station_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256Hex(token),
      'userId' in owner ? owner.userId : null,
      'stationId' in owner ? owner.stationId : null,
      now,
      now,
      expiresAt,
    )
    .run();
  return { token, expiresAt };
}

export async function revokeSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL`)
    .bind(nowIso(), await sha256Hex(token))
    .run();
}

interface SessionRow {
  id_hash: string;
  user_id: string | null;
  station_id: string | null;
  last_seen_at: string;
  expires_at: string;
  preview_event_id: string | null;
  preview_role_id: string | null;
  preview_activity_id: string | null;
}

/**
 * Resolve a session token to a principal. Permissions are loaded fresh on
 * every request, so role changes and revocations take effect immediately.
 */
export async function loadPrincipal(env: Env, token: string): Promise<Principal | null> {
  const idHash = await sha256Hex(token);
  const now = nowIso();
  const session = await env.DB.prepare(
    `SELECT id_hash, user_id, station_id, last_seen_at, expires_at, preview_event_id, preview_role_id, preview_activity_id
       FROM sessions WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(idHash, now)
    .first<SessionRow>();
  if (!session) return null;

  if (session.user_id) {
    if (addMinutes(session.last_seen_at, USER_IDLE_HOURS * 60) <= now) return null;
    const principal = await loadUserPrincipal(env, session.user_id);
    if (!principal) return null;
    await touch(env, session, now);
    if (session.preview_event_id && session.preview_role_id) {
      return (await applyPreview(env, principal, session)) ?? principal;
    }
    return principal;
  }

  const station = await env.DB.prepare(
    `SELECT s.id, s.event_id, s.context_type, s.context_id
       FROM stations s JOIN events e ON e.id = s.event_id
      WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND e.status = 'open'`,
  )
    .bind(session.station_id, now)
    .first<{ id: string; event_id: string; context_type: 'activity' | 'meal' | 'site'; context_id: string | null }>();
  if (!station) return null;
  await touch(env, session, now);
  return {
    kind: 'station',
    stationId: station.id,
    eventId: station.event_id,
    contextType: station.context_type,
    contextId: station.context_id,
  };
}

async function touch(env: Env, session: SessionRow, now: string): Promise<void> {
  if (addMinutes(session.last_seen_at, TOUCH_INTERVAL_MINUTES) > now) return;
  await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?`)
    .bind(now, session.id_hash)
    .run();
}

export async function loadUserPrincipal(env: Env, userId: string): Promise<UserPrincipal | null> {
  const user = await env.DB.prepare(
    `SELECT id, email, display_name, password_hash IS NOT NULL AS has_password, is_demo FROM users WHERE id = ? AND status = 'active'`,
  )
    .bind(userId)
    .first<{ id: string; email: string; display_name: string; has_password: number; is_demo: number }>();
  if (!user) return null;

  const { results } = await env.DB.prepare(
    `SELECT a.id AS assignment_id, r.key AS role_key, a.event_id, a.activity_id,
            group_concat(rp.permission) AS permissions
       FROM assignments a
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN events e ON e.id = a.event_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE a.user_id = ? AND a.revoked_at IS NULL
        AND (a.event_id IS NULL OR e.status <> 'archived')
      GROUP BY a.id`,
  )
    .bind(userId)
    .all<{ assignment_id: string; role_key: string; event_id: string | null; activity_id: string | null; permissions: string | null }>();

  const grants: AssignmentGrant[] = results.map((row) => ({
    assignmentId: row.assignment_id,
    roleKey: row.role_key,
    eventId: row.event_id,
    activityId: row.activity_id,
    permissions: new Set((row.permissions ?? '').split(',').filter(Boolean) as Permission[]),
  }));

  return {
    kind: 'user',
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    hasPassword: user.has_password === 1,
    isDemo: user.is_demo === 1,
    grants,
  };
}

/**
 * Replace an admin's grants with a single previewed role. Only honoured while
 * the real account still holds platform.users.manage.
 */
async function applyPreview(env: Env, principal: UserPrincipal, session: SessionRow): Promise<UserPrincipal | null> {
  const isAdmin = principal.grants.some((g) => g.eventId === null && g.permissions.has('platform.users.manage'));
  if (!isAdmin) return null;
  const row = await env.DB.prepare(
    `SELECT e.id AS event_id, e.name AS event_name, r.key AS role_key, r.name AS role_name,
            a.id AS activity_id, a.name AS activity_name, group_concat(rp.permission) AS permissions
       FROM events e
       JOIN roles r ON r.id = ?2
       LEFT JOIN activities a ON a.id = ?3 AND a.event_id = e.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE e.id = ?1 AND e.status <> 'archived'
      GROUP BY e.id, r.id`,
  )
    .bind(session.preview_event_id, session.preview_role_id, session.preview_activity_id)
    .first<{ event_id: string; event_name: string; role_key: string; role_name: string; activity_id: string | null; activity_name: string | null; permissions: string | null }>();
  if (!row) return null;
  return {
    ...principal,
    grants: [
      {
        assignmentId: 'preview',
        roleKey: row.role_key,
        eventId: row.event_id,
        activityId: row.activity_id,
        permissions: new Set((row.permissions ?? '').split(',').filter(Boolean) as Permission[]),
      },
    ],
    preview: {
      eventId: row.event_id,
      eventName: row.event_name,
      roleKey: row.role_key,
      roleName: row.role_name,
      activityId: row.activity_id,
      activityName: row.activity_name,
    },
  };
}
