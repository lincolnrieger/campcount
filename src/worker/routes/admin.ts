import { Hono } from 'hono';
import { z } from 'zod';
import { createUserSchema } from '../../shared/schemas';
import type { AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';

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
