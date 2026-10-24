import { Hono } from 'hono';
import { z } from 'zod';
import { createAssignmentSchema } from '../../shared/schemas';
import type { Permission } from '../../shared/permissions';
import type { AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import type { UserPrincipal } from '../services/principal';
import { can } from '../services/principal';
import { getEventRow } from './events';

export const staffRoutes = new Hono<AppEnv>();

interface RoleRow {
  id: string;
  key: string;
  name: string;
  scope: 'platform' | 'event' | 'activity';
  permissions: string | null;
}

async function loadRole(db: D1Database, roleKey: string): Promise<(RoleRow & { perms: Permission[] }) | null> {
  const row = await db
    .prepare(
      `SELECT r.id, r.key, r.name, r.scope, group_concat(rp.permission) AS permissions
         FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.key = ? GROUP BY r.id`,
    )
    .bind(roleKey)
    .first<RoleRow>();
  if (!row) return null;
  return { ...row, perms: (row.permissions ?? '').split(',').filter(Boolean) as Permission[] };
}

/**
 * No privilege escalation: you can only grant or remove a role whose every
 * permission you hold yourself in this event. Platform overseers may appoint
 * anyone (that is how a Camp Director is first assigned).
 */
function assertCanDelegate(principal: UserPrincipal, eventId: string, perms: Permission[]): void {
  if (can(principal, 'platform.events.oversee')) return;
  for (const p of perms) {
    if (!can(principal, p, { eventId })) throw forbidden();
  }
}

staffRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'staff.manage', { eventId });
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.activity_id, a.created_at, u.id AS user_id, u.email, u.display_name, u.status,
            r.key AS role_key, r.name AS role_name, act.name AS activity_name
       FROM assignments a
       JOIN users u ON u.id = a.user_id
       JOIN roles r ON r.id = a.role_id
       LEFT JOIN activities act ON act.id = a.activity_id
      WHERE a.event_id = ? AND a.revoked_at IS NULL
      ORDER BY u.display_name`,
  )
    .bind(eventId)
    .all<Record<string, string | null>>();
  return c.json({
    staff: results.map((r) => ({
      assignmentId: r.id,
      user: { id: r.user_id, email: r.email, displayName: r.display_name, status: r.status },
      role: { key: r.role_key, name: r.role_name },
      activity: r.activity_id ? { id: r.activity_id, name: r.activity_name } : null,
      createdAt: r.created_at,
    })),
  });
});

staffRoutes.post('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'staff.manage', { eventId });
  const principal = requireUser(c);
  const input = await parseBody(c, createAssignmentSchema);

  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (event.status === 'archived' || event.status === 'cancelled') throw conflict('This event is closed.');

  const role = await loadRole(c.env.DB, input.roleKey);
  if (!role || role.scope === 'platform') throw badRequest('Choose an event role.');
  if (input.activityId) {
    if (role.scope !== 'activity') throw badRequest('Only activity roles can be limited to one activity.');
    const activity = await c.env.DB.prepare(`SELECT 1 FROM activities WHERE id = ? AND event_id = ?`)
      .bind(input.activityId, eventId)
      .first();
    if (!activity) throw badRequest('That activity is not part of this event.');
  }
  assertCanDelegate(principal, eventId, role.perms);

  const now = nowIso();
  let user = await c.env.DB.prepare(`SELECT id, status FROM users WHERE email = ?`)
    .bind(input.email)
    .first<{ id: string; status: string }>();
  const statements: D1PreparedStatement[] = [];
  if (!user) {
    if (!input.displayName) throw badRequest('Enter a name for this new person.');
    user = { id: crypto.randomUUID(), status: 'active' };
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(user.id, input.email, input.displayName, now, now),
      auditStatement(c.env.DB, {
        actor: { type: 'user', id: principal.userId },
        action: 'user.create',
        eventId,
        targetType: 'user',
        targetId: user.id,
      }),
    );
  }
  const assignmentId = crypto.randomUUID();
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO assignments (id, user_id, role_id, event_id, activity_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(assignmentId, user.id, role.id, eventId, input.activityId ?? null, principal.userId, now),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: principal.userId },
      action: 'assignment.grant',
      eventId,
      targetType: 'assignment',
      targetId: assignmentId,
      detail: { userId: user.id, role: role.key, activityId: input.activityId ?? null },
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw conflict('That person already has this role.');
    throw err;
  }
  return c.json({ assignmentId }, 201);
});

staffRoutes.delete('/:assignmentId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const assignmentId = z.uuid().safeParse(c.req.param('assignmentId'));
  requirePermission(c, 'staff.manage', { eventId });
  const principal = requireUser(c);
  if (!assignmentId.success) throw notFound();

  const row = await c.env.DB.prepare(
    `SELECT a.user_id, r.key AS role_key FROM assignments a JOIN roles r ON r.id = a.role_id
      WHERE a.id = ? AND a.event_id = ? AND a.revoked_at IS NULL`,
  )
    .bind(assignmentId.data, eventId)
    .first<{ user_id: string; role_key: string }>();
  if (!row) throw notFound();
  if (row.user_id === principal.userId) throw conflict('You cannot remove your own role. Ask another director or an administrator.');
  const role = await loadRole(c.env.DB, row.role_key);
  assertCanDelegate(principal, eventId, role!.perms);

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE assignments SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL`,
    ).bind(now, principal.userId, assignmentId.data),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: principal.userId },
      action: 'assignment.revoke',
      eventId,
      targetType: 'assignment',
      targetId: assignmentId.data,
      detail: { userId: row.user_id, role: row.role_key },
    }),
  ]);
  return c.json({ ok: true });
});

const changeRoleSchema = z.strictObject({
  roleKey: z.string().regex(/^[a-z_]{2,40}$/),
  activityId: z.uuid().nullable().optional(),
});

/** Change someone's role in one step: the old assignment is ended and a new one starts, both audited. */
staffRoutes.patch('/:assignmentId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const assignmentId = z.uuid().safeParse(c.req.param('assignmentId'));
  requirePermission(c, 'staff.manage', { eventId });
  const principal = requireUser(c);
  if (!assignmentId.success) throw notFound();
  const input = await parseBody(c, changeRoleSchema);

  const current = await c.env.DB.prepare(
    `SELECT a.user_id, r.key AS role_key FROM assignments a JOIN roles r ON r.id = a.role_id
      WHERE a.id = ? AND a.event_id = ? AND a.revoked_at IS NULL`,
  )
    .bind(assignmentId.data, eventId)
    .first<{ user_id: string; role_key: string }>();
  if (!current) throw notFound();
  if (current.user_id === principal.userId) throw conflict('You cannot change your own role. Ask another director or an administrator.');

  const [oldRole, newRole] = await Promise.all([loadRole(c.env.DB, current.role_key), loadRole(c.env.DB, input.roleKey)]);
  if (!newRole || newRole.scope === 'platform') throw badRequest('Choose an event role.');
  assertCanDelegate(principal, eventId, oldRole!.perms);
  assertCanDelegate(principal, eventId, newRole.perms);
  let activityId: string | null = null;
  if (input.activityId) {
    if (newRole.scope !== 'activity') throw badRequest('Only activity roles can be limited to one activity.');
    const activity = await c.env.DB.prepare(`SELECT 1 FROM activities WHERE id = ? AND event_id = ?`).bind(input.activityId, eventId).first();
    if (!activity) throw badRequest('That activity is not part of this event.');
    activityId = input.activityId;
  }

  const now = nowIso();
  const newId = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE assignments SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL`).bind(
        now,
        principal.userId,
        assignmentId.data,
      ),
      c.env.DB.prepare(
        `INSERT INTO assignments (id, user_id, role_id, event_id, activity_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId, current.user_id, newRole.id, eventId, activityId, principal.userId, now),
      auditStatement(c.env.DB, {
        actor: { type: 'user', id: principal.userId },
        action: 'assignment.change',
        eventId,
        targetType: 'assignment',
        targetId: newId,
        detail: { userId: current.user_id, from: current.role_key, to: newRole.key, activityId },
      }),
    ]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw conflict('That person already has this role.');
    throw err;
  }
  return c.json({ assignmentId: newId });
});
