import { Hono } from 'hono';
import { z } from 'zod';
import { createUserSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { getCookie } from 'hono/cookie';
import { auditStatement } from '../services/audit';
import { createDemoEvent, deleteDemoEvent } from '../services/demo';
import { deleteAccount, isLastAdmin } from '../services/accounts';
import { SESSION_COOKIE } from '../services/sessions';
import { sha256Hex } from '../lib/crypto';
import { can } from '../services/principal';
import type { UserPrincipal } from '../services/principal';
import { createPasswordLink, emailPasswordLink } from '../services/passwordLinks';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/users', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.email_verified_at, u.is_demo, u.password_hash IS NOT NULL AS has_password,
            EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id AND a.role_id = 'role_platform_admin' AND a.revoked_at IS NULL) AS is_admin,
            (SELECT count(DISTINCT a.event_id) FROM assignments a WHERE a.user_id = u.id AND a.revoked_at IS NULL AND a.event_id IS NOT NULL) AS events,
            (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
       FROM users u WHERE u.email NOT LIKE '%@deleted.invalid' ORDER BY u.display_name COLLATE NOCASE`,
  ).all<{ id: string; email: string; display_name: string; status: string; created_at: string; email_verified_at: string | null; is_demo: number; has_password: number; is_admin: number; events: number; last_seen: string | null }>();
  return c.json({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      platformAdmin: u.is_admin === 1,
      createdAt: u.created_at,
      verified: u.email_verified_at !== null,
      isDemo: u.is_demo === 1,
      hasPassword: u.has_password === 1,
      events: u.events,
      lastSeen: u.last_seen,
    })),
  });
});

adminRoutes.post('/users', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const input = await parseBody(c, createUserSchema);
  const existing = await c.env.DB.prepare(`SELECT 1 FROM users WHERE email = ?`).bind(input.email).first();
  if (existing) throw conflict('An account with that email already exists.');
  const now = nowIso();
  const id = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, input.email, input.displayName, now, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: actor.userId }, action: 'user.create', targetType: 'user', targetId: id }),
  ];
  if (input.platformAdmin) {
    const assignmentId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO assignments (id, user_id, role_id, created_by, created_at) VALUES (?, ?, 'role_platform_admin', ?, ?)`,
      ).bind(assignmentId, id, actor.userId, now),
      auditStatement(c.env.DB, {
        actor: { type: 'user', id: actor.userId },
        action: 'assignment.grant',
        targetType: 'assignment',
        targetId: assignmentId,
        detail: { userId: id, role: 'platform_admin' },
      }),
    );
  }
  await c.env.DB.batch(statements);
  // New accounts start without a password: they set one from this link.
  const actorRow = await c.env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(actor.userId).first<{ display_name: string }>();
  const link = await createPasswordLink(c.env, new URL(c.req.url).origin, id, 'setup', { type: 'user', id: actor.userId });
  const emailed = input.sendEmail
    ? await emailPasswordLink(c.env, { email: input.email, name: input.displayName }, link, 'setup', { inviter: actorRow?.display_name ?? 'An administrator' })
    : false;
  return c.json({ id, link: link.url, expiresAt: link.expiresAt, emailed }, 201);
});

const passwordLinkRequestSchema = z.strictObject({ sendEmail: z.boolean().default(false) });

/**
 * A one-time link for someone to set a new password: for people who have
 * forgotten theirs, or never set one. The admin can copy it to pass on, or
 * have it emailed. Making a new link retires any earlier one.
 */
adminRoutes.post('/users/:userId/password-link', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const userId = z.uuid().safeParse(c.req.param('userId'));
  if (!userId.success) throw notFound();
  const { sendEmail } = await parseBody(c, passwordLinkRequestSchema);
  const user = await c.env.DB.prepare(`SELECT email, display_name, status, password_hash IS NOT NULL AS has_password FROM users WHERE id = ?`)
    .bind(userId.data)
    .first<{ email: string; display_name: string; status: string; has_password: number }>();
  if (!user || user.email.endsWith('@deleted.invalid')) throw notFound();
  if (user.status !== 'active') throw conflict('Enable this account first.');
  const purpose = user.has_password ? 'reset' : 'setup';
  const link = await createPasswordLink(c.env, new URL(c.req.url).origin, userId.data, purpose, { type: 'user', id: actor.userId });
  const emailed = sendEmail ? await emailPasswordLink(c.env, { email: user.email, name: user.display_name }, link, purpose) : false;
  return c.json({ link: link.url, expiresAt: link.expiresAt, purpose, emailed });
});

const statusSchema = z.strictObject({ status: z.enum(['active', 'disabled']) });

adminRoutes.post('/users/:userId/status', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const userId = c.req.param('userId');
  const { status } = await parseBody(c, statusSchema);
  if (userId === actor.userId) throw conflict('You cannot change the status of your own account.');
  const now = nowIso();
  const statements = [
    c.env.DB.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, userId),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: actor.userId },
      action: status === 'disabled' ? 'user.disable' : 'user.enable',
      targetType: 'user',
      targetId: userId,
    }),
  ];
  // Disabling ends every session immediately.
  if (status === 'disabled') {
    statements.push(
      c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, userId),
    );
  }
  const [update] = await c.env.DB.batch(statements);
  if (update!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

const userPatchSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100).optional(),
  platformAdmin: z.boolean().optional(),
});

adminRoutes.patch('/users/:userId', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const userId = c.req.param('userId');
  const input = await parseBody(c, userPatchSchema);
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
  if (!target) throw notFound();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (input.displayName !== undefined) {
    statements.push(
      c.env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`).bind(input.displayName, now, userId),
      auditStatement(c.env.DB, { actor: { type: 'user', id: actor.userId }, action: 'user.rename', targetType: 'user', targetId: userId }),
    );
  }
  if (input.platformAdmin === true) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO assignments (id, user_id, role_id, created_by, created_at)
         SELECT ?, ?, 'role_platform_admin', ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM assignments WHERE user_id = ? AND role_id = 'role_platform_admin' AND revoked_at IS NULL)`,
      ).bind(crypto.randomUUID(), userId, actor.userId, now, userId),
      auditStatement(c.env.DB, {
        onlyIfChanged: true,
        actor: { type: 'user', id: actor.userId },
        action: 'assignment.grant',
        targetType: 'user',
        targetId: userId,
        detail: { role: 'platform_admin' },
      }),
    );
  }
  if (input.platformAdmin === false) {
    if (userId === actor.userId) throw conflict('You cannot remove your own admin access.');
    statements.push(
      c.env.DB.prepare(
        `UPDATE assignments SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND role_id = 'role_platform_admin' AND revoked_at IS NULL`,
      ).bind(now, actor.userId, userId),
      auditStatement(c.env.DB, {
        onlyIfChanged: true,
        actor: { type: 'user', id: actor.userId },
        action: 'assignment.revoke',
        targetType: 'user',
        targetId: userId,
        detail: { role: 'platform_admin' },
      }),
    );
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

adminRoutes.delete('/users/:userId', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const userId = c.req.param('userId');
  if (userId === actor.userId) throw conflict('To delete your own account, use the Account page.');
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
  if (!target) throw notFound();
  if (await isLastAdmin(c.env, userId)) throw conflict('This is the only admin. Make someone else an admin first.');
  const result = await deleteAccount(c.env, userId, { type: 'user', id: actor.userId });
  return c.json({ result });
});

const auditQuery = z.object({
  eventId: z.uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
});

adminRoutes.get('/audit', async (c) => {
  requirePermission(c, 'platform.audit.read');
  const q = auditQuery.parse(c.req.query());
  const { results } = await c.env.DB.prepare(
    `SELECT id, at, actor_type, actor_id, action, event_id, target_type, target_id, detail
       FROM audit_log
      WHERE (?1 IS NULL OR event_id = ?1) AND (?2 IS NULL OR id < ?2)
      ORDER BY id DESC LIMIT 100`,
  )
    .bind(q.eventId ?? null, q.before ?? null)
    .all();
  return c.json({ entries: results });
});

const logQuery = z.object({
  kind: z.enum(['all', 'scans', 'changes']).default('all'),
  eventId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  before: z.iso.datetime().optional(),
});

const LOG_PAGE = 100;

/**
 * Everything CampCount has recorded, newest first: every scan (who, where,
 * by whom, and the result) and every change in the audit log (sign-ins,
 * edits, deletions, exports). Filter by event, kind and free text.
 */
adminRoutes.get('/log', async (c) => {
  requirePermission(c, 'platform.audit.read');
  const q = logQuery.parse(c.req.query());
  const like = q.q ? `%${q.q.replace(/[%_]/g, '')}%` : null;
  const before = q.before ?? '9999';
  const [scans, changes] = await Promise.all([
    q.kind === 'changes'
      ? null
      : c.env.DB.prepare(
          `SELECT s.id, s.device_time AS at, s.event_id, e.name AS event_name, s.context_type, s.direction, s.method, s.outcome,
                  s.outcome_reason, s.correction_reason,
                  COALESCE(p.first_name || ' ' || p.last_name, 'Unknown card') AS person, s.registration_id,
                  COALESCE(a.name, m.name, CASE WHEN s.context_type = 'site' THEN 'Gate' END, 'Deleted') AS place,
                  COALESCE(u.display_name, st.name, '') AS actor
             FROM scans s
             JOIN events e ON e.id = s.event_id
             LEFT JOIN registrations r ON r.id = s.registration_id
             LEFT JOIN people p ON p.id = r.person_id
             LEFT JOIN activities a ON s.context_type = 'activity' AND a.id = s.context_id
             LEFT JOIN meal_services m ON s.context_type = 'meal' AND m.id = s.context_id
             LEFT JOIN users u ON u.id = s.actor_user_id
             LEFT JOIN stations st ON st.id = s.actor_station_id
            WHERE s.device_time < ?1 AND (?2 IS NULL OR s.event_id = ?2)
              AND (?3 IS NULL OR p.first_name || ' ' || p.last_name LIKE ?3 OR p.preferred_name LIKE ?3 OR p.member_number LIKE ?3
                   OR a.name LIKE ?3 OR m.name LIKE ?3 OR u.display_name LIKE ?3 OR st.name LIKE ?3)
            ORDER BY s.device_time DESC LIMIT ${LOG_PAGE}`,
        )
          .bind(before, q.eventId ?? null, like)
          .all<Record<string, string>>(),
    q.kind === 'scans'
      ? null
      : c.env.DB.prepare(
          `SELECT l.id, l.at, l.actor_type, l.action, l.event_id, e.name AS event_name, l.target_type, l.target_id, l.detail,
                  COALESCE(au.display_name, ast.name, CASE l.actor_type WHEN 'system' THEN 'CampCount' WHEN 'public' THEN 'Someone (not signed in)' END, '') AS actor,
                  COALESCE(tu.display_name, tp.first_name || ' ' || tp.last_name, ta.name, tm.name, te.name, '') AS target
             FROM audit_log l
             LEFT JOIN events e ON e.id = l.event_id
             LEFT JOIN users au ON l.actor_type = 'user' AND au.id = l.actor_id
             LEFT JOIN stations ast ON l.actor_type = 'station' AND ast.id = l.actor_id
             LEFT JOIN users tu ON l.target_type = 'user' AND tu.id = l.target_id
             LEFT JOIN registrations tr ON l.target_type = 'registration' AND tr.id = l.target_id
             LEFT JOIN people tp ON tp.id = tr.person_id
             LEFT JOIN activities ta ON l.target_type = 'activity' AND ta.id = l.target_id
             LEFT JOIN meal_services tm ON l.target_type = 'meal' AND tm.id = l.target_id
             LEFT JOIN events te ON l.target_type = 'event' AND te.id = l.target_id
            WHERE l.at < ?1 AND (?2 IS NULL OR l.event_id = ?2)
              AND (?3 IS NULL OR l.action LIKE ?3 OR au.display_name LIKE ?3 OR tu.display_name LIKE ?3
                   OR tp.first_name || ' ' || tp.last_name LIKE ?3 OR ta.name LIKE ?3 OR tm.name LIKE ?3 OR e.name LIKE ?3)
            ORDER BY l.at DESC, l.id DESC LIMIT ${LOG_PAGE}`,
        )
          .bind(before, q.eventId ?? null, like)
          .all<Record<string, string | number>>(),
  ]);
  const entries = [
    ...(scans?.results ?? []).map((s) => ({
      kind: 'scan' as const,
      id: `scan:${s.id}`,
      at: s.at!,
      eventId: s.event_id,
      eventName: s.event_name,
      person: s.person,
      registrationId: s.registration_id,
      place: s.place,
      contextType: s.context_type,
      direction: s.direction,
      method: s.method,
      outcome: s.outcome,
      note: s.correction_reason || s.outcome_reason,
      actor: s.actor,
    })),
    ...(changes?.results ?? []).map((l) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(String(l.detail));
      } catch {
        // Older rows may not be JSON.
      }
      return {
        kind: 'change' as const,
        id: `audit:${l.id}`,
        at: String(l.at),
        eventId: l.event_id as string | null,
        eventName: l.event_name as string | null,
        action: String(l.action),
        actorType: String(l.actor_type),
        actor: String(l.actor),
        targetType: l.target_type as string | null,
        target: String(l.target || (typeof detail.name === 'string' ? detail.name : '')),
        detail,
      };
    }),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, LOG_PAGE);
  const full = (scans?.results.length ?? 0) === LOG_PAGE || (changes?.results.length ?? 0) === LOG_PAGE;
  return c.json({ entries, nextBefore: full && entries.length ? entries[entries.length - 1]!.at : null });
});

// ---------------------------------------------------------------- demo mode

const demoCreateSchema = z.strictObject({ participants: z.number().int().min(10).max(400).default(80) });

adminRoutes.get('/demo', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const { results: events } = await c.env.DB.prepare(
    `SELECT e.id, e.name, e.status, e.created_at,
            (SELECT count(*) FROM registrations r WHERE r.event_id = e.id) AS people
       FROM events e WHERE e.is_demo = 1 ORDER BY e.created_at DESC`,
  ).all<{ id: string; name: string; status: string; created_at: string; people: number }>();
  const { results: users } = await c.env.DB.prepare(
    `SELECT u.id, u.display_name, a.event_id, r.name AS role_name, act.name AS activity_name
       FROM users u JOIN assignments a ON a.user_id = u.id AND a.revoked_at IS NULL
       JOIN roles r ON r.id = a.role_id LEFT JOIN activities act ON act.id = a.activity_id
      WHERE u.is_demo = 1 AND u.status = 'active' ORDER BY u.display_name`,
  ).all<{ id: string; display_name: string; event_id: string; role_name: string; activity_name: string | null }>();
  return c.json({
    events: events.map((e) => ({
      ...e,
      accounts: users
        .filter((u) => u.event_id === e.id)
        .map((u) => ({ id: u.id, name: u.display_name, role: u.role_name, activity: u.activity_name })),
    })),
  });
});

adminRoutes.post('/demo', async (c) => {
  requirePermission(c, 'platform.users.manage');
  requirePermission(c, 'platform.events.create');
  const actor = requireUser(c);
  if (actor.isDemo) throw conflict('Demo accounts cannot create demo events.');
  const { participants } = await parseBody(c, demoCreateSchema);
  const { eventId } = await createDemoEvent(c.env, actor.userId, participants);
  return c.json({ eventId }, 201);
});

adminRoutes.delete('/demo/:eventId', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  if (!(await deleteDemoEvent(c.env, actor.userId, c.req.param('eventId')))) throw notFound();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- view as (role preview)

/** A platform admin, or an admin currently previewing a role (who must be able to switch or stop). */
function requireRealAdmin(c: AppContext): UserPrincipal {
  const user = requireUser(c);
  if (!user.preview && !can(user, 'platform.users.manage')) throw forbidden();
  return user;
}

adminRoutes.get('/preview/options', async (c) => {
  requireRealAdmin(c);
  const { results: events } = await c.env.DB.prepare(
    `SELECT id, name, is_demo, status FROM events WHERE status <> 'archived' ORDER BY is_demo DESC, starts_on DESC`,
  ).all<{ id: string; name: string; is_demo: number; status: string }>();
  const { results: activities } = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.event_id FROM activities a JOIN events e ON e.id = a.event_id
      WHERE e.status <> 'archived' AND a.status = 'active' ORDER BY a.name COLLATE NOCASE`,
  ).all<{ id: string; name: string; event_id: string }>();
  const { results: roles } = await c.env.DB.prepare(
    `SELECT key, name, description, scope FROM roles WHERE scope <> 'platform' ORDER BY CASE key
       WHEN 'event_manager' THEN 1 WHEN 'scanner' THEN 2 WHEN 'activity_leader' THEN 3 WHEN 'meal_leader' THEN 4 ELSE 9 END, name`,
  ).all();
  return c.json({
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      isDemo: e.is_demo === 1,
      status: e.status,
      activities: activities.filter((a) => a.event_id === e.id).map((a) => ({ id: a.id, name: a.name })),
    })),
    roles,
  });
});

const previewSchema = z.strictObject({
  eventId: z.uuid(),
  roleKey: z.string().regex(/^[a-z_]{2,40}$/),
  activityId: z.uuid().nullable().optional(),
});

/**
 * See an event exactly as a role sees it. Applies to this session only, is
 * recorded in the audit log, and ends with "Back to me" or sign-out.
 */
adminRoutes.post('/preview', async (c) => {
  const user = requireRealAdmin(c);
  const input = await parseBody(c, previewSchema);
  const role = await c.env.DB.prepare(`SELECT id, scope FROM roles WHERE key = ?`)
    .bind(input.roleKey)
    .first<{ id: string; scope: string }>();
  if (!role || role.scope === 'platform') throw badRequest('Choose an event role.');
  const event = await c.env.DB.prepare(`SELECT id FROM events WHERE id = ? AND status <> 'archived'`).bind(input.eventId).first();
  if (!event) throw notFound();
  let activityId: string | null = null;
  if (role.scope === 'activity' && input.activityId) {
    const activity = await c.env.DB.prepare(`SELECT id FROM activities WHERE id = ? AND event_id = ?`)
      .bind(input.activityId, input.eventId)
      .first<{ id: string }>();
    if (!activity) throw badRequest('That activity is not part of this event.');
    activityId = activity.id;
  }
  const token = getCookie(c, SESSION_COOKIE)!;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sessions SET preview_event_id = ?, preview_role_id = ?, preview_activity_id = ? WHERE id_hash = ?`).bind(
      input.eventId,
      role.id,
      activityId,
      await sha256Hex(token),
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'preview.start',
      eventId: input.eventId,
      detail: { role: input.roleKey, activityId },
    }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.delete('/preview', async (c) => {
  const user = requireRealAdmin(c);
  const token = getCookie(c, SESSION_COOKIE)!;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE sessions SET preview_event_id = NULL, preview_role_id = NULL, preview_activity_id = NULL WHERE id_hash = ?`).bind(
      await sha256Hex(token),
    ),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'preview.stop', eventId: user.preview?.eventId ?? null }),
  ]);
  return c.json({ ok: true });
});
