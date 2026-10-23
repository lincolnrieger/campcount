import { Hono } from 'hono';
import { z } from 'zod';
import { createUserSchema } from '../../shared/schemas';
import type { AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { getCookie } from 'hono/cookie';
import { audit, auditStatement } from '../services/audit';
import { createDemoEvent, deleteDemoEvent } from '../services/demo';
import { SESSION_COOKIE, revokeSession } from '../services/sessions';
import { startSession } from './auth';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/users', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.status, u.created_at,
            EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = u.id AND a.role_id = 'role_platform_admin' AND a.revoked_at IS NULL) AS is_admin
       FROM users u ORDER BY u.display_name`,
  ).all<{ id: string; email: string; display_name: string; status: string; created_at: string; is_admin: number }>();
  return c.json({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      platformAdmin: u.is_admin === 1,
      createdAt: u.created_at,
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
  return c.json({ id }, 201);
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

/**
 * Sign in as a demo account to see CampCount as that role. Only accounts
 * marked as demo can be used this way; it is recorded in the audit log.
 * To get back, sign out and sign in as yourself.
 */
adminRoutes.post('/demo/users/:userId/switch', async (c) => {
  requirePermission(c, 'platform.users.manage');
  const actor = requireUser(c);
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ? AND is_demo = 1 AND status = 'active'`)
    .bind(c.req.param('userId'))
    .first<{ id: string }>();
  if (!target) throw notFound();
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.env, token);
  await audit(c.env.DB, { actor: { type: 'user', id: actor.userId }, action: 'demo.switch_user', targetType: 'user', targetId: target.id });
  await startSession(c, target.id, 'demo_switch');
  return c.json({ ok: true });
});
