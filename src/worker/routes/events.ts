import { Hono } from 'hono';
import { canTransition } from '../../shared/lifecycle';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { createEventSchema, eventTransitionSchema, updateEventSchema } from '../../shared/schemas';
import type { AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { loadEventModel, openItems } from '../services/reports';
import { can, eventPermissions } from '../services/principal';

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  location: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  status: EventStatus;
  feature_activities: number;
  feature_meals: number;
  feature_site: number;
  feature_dietary: number;
  feature_photo: number;
  feature_self_signup: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  is_demo: number;
}

const FEATURE_COLUMNS: Record<keyof EventFeatures, keyof EventRow> = {
  activities: 'feature_activities',
  meals: 'feature_meals',
  site: 'feature_site',
  dietary: 'feature_dietary',
  photo: 'feature_photo',
  selfSignup: 'feature_self_signup',
};

export function eventDto(row: EventRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    location: row.location,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    timezone: row.timezone,
    status: row.status,
    features: Object.fromEntries(
      Object.entries(FEATURE_COLUMNS).map(([k, col]) => [k, row[col] === 1]),
    ) as EventFeatures,
    closedAt: row.closed_at,
    isDemo: row.is_demo === 1,
  };
}

export async function getEventRow(db: D1Database, eventId: string): Promise<EventRow | null> {
  return db.prepare(`SELECT * FROM events WHERE id = ?`).bind(eventId).first<EventRow>();
}

function slugify(name: string, startsOn: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'event'}-${startsOn.slice(0, 4)}-${crypto.randomUUID().slice(0, 4)}`;
}

export const eventRoutes = new Hono<AppEnv>();

/** Events the caller can see. Never lists events they have no grant for. */
eventRoutes.get('/', async (c) => {
  const principal = requirePrincipal(c);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM events WHERE status <> 'archived' OR ? = 1 ORDER BY starts_on DESC`,
  )
    .bind(can(principal, 'platform.events.oversee') ? 1 : 0)
    .all<EventRow>();
  const visible = results.filter((e) => can(principal, 'event.view', { eventId: e.id }));
  return c.json({
    events: visible.map((e) => ({ ...eventDto(e), permissions: eventPermissions(principal, e.id) })),
  });
});

eventRoutes.post('/', async (c) => {
  requirePermission(c, 'platform.events.create');
  const user = requireUser(c);
  const input = await parseBody(c, createEventSchema);
  const now = nowIso();
  const id = crypto.randomUUID();
  const f = input.features;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO events (id, slug, name, description, location, starts_on, ends_on,
         feature_activities, feature_meals, feature_site, feature_dietary, feature_photo, feature_self_signup,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      slugify(input.name, input.startsOn),
      input.name,
      input.description,
      input.location,
      input.startsOn,
      input.endsOn,
      f.activities === false ? 0 : 1,
      f.meals ? 1 : 0,
      f.site ? 1 : 0,
      f.dietary ? 1 : 0,
      f.photo === false ? 0 : 1,
      f.selfSignup ? 1 : 0,
      user.userId,
      now,
      now,
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'event.create',
      eventId: id,
      targetType: 'event',
      targetId: id,
    }),
  ]);
  const row = await getEventRow(c.env.DB, id);
  return c.json({ event: eventDto(row!) }, 201);
});

eventRoutes.get('/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  const principal = requirePermission(c, 'event.view', { eventId });
  const row = await getEventRow(c.env.DB, eventId);
  if (!row) throw notFound();
  return c.json({ event: { ...eventDto(row), permissions: eventPermissions(principal, eventId) } });
});

eventRoutes.patch('/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  const principal = requirePermission(c, 'event.configure', { eventId });
  const input = await parseBody(c, updateEventSchema);
  const row = await getEventRow(c.env.DB, eventId);
  if (!row) throw notFound();
  if (row.status !== 'draft' && row.status !== 'open') {
    throw conflict('This event is closed. Reopen it before changing its settings.');
  }

  const sets: string[] = [];
  const values: (string | number)[] = [];
  const set = (col: string, value: string | number) => {
    sets.push(`${col} = ?`);
    values.push(value);
  };
  if (input.name !== undefined) set('name', input.name);
  if (input.description !== undefined) set('description', input.description);
  if (input.location !== undefined) set('location', input.location);
  if (input.startsOn !== undefined) set('starts_on', input.startsOn);
  if (input.endsOn !== undefined) set('ends_on', input.endsOn);
  for (const [key, value] of Object.entries(input.features ?? {})) {
    if (value !== undefined) set(FEATURE_COLUMNS[key as keyof EventFeatures], value ? 1 : 0);
  }
  if (sets.length === 0) return c.json({ event: eventDto(row) });

  const startsOn = input.startsOn ?? row.starts_on;
  const endsOn = input.endsOn ?? row.ends_on;
  if (endsOn < startsOn) throw badRequest('The event must end on or after its start date.');

  set('updated_at', nowIso());
  await c.env.DB.batch([
    // Column names come from the fixed map above, never from the client.
    c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...values, eventId),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: (principal as { userId: string }).userId },
      action: 'event.update',
      eventId,
      targetType: 'event',
      targetId: eventId,
      detail: { fields: Object.keys(input).join(',') },
    }),
  ]);
  return c.json({ event: eventDto((await getEventRow(c.env.DB, eventId))!) });
});

eventRoutes.post('/:eventId/transition', async (c) => {
  const eventId = c.req.param('eventId');
  const { to, acknowledgeOpenItems } = await parseBody(c, eventTransitionSchema);
  requirePermission(c, 'event.view', { eventId });
  const user = requireUser(c);
  const row = await getEventRow(c.env.DB, eventId);
  if (!row) throw notFound();
  // Publishing a draft is configuration; completing, cancelling and reopening
  // are close-out; archiving is a platform decision.
  if (to === 'archived') requirePermission(c, 'platform.events.oversee');
  else if (row.status === 'draft' && to === 'open') requirePermission(c, 'event.configure', { eventId });
  else requirePermission(c, 'event.close', { eventId });
  if (!canTransition(row.status, to)) {
    throw conflict(`An event cannot move from ${row.status} to ${to}.`);
  }
  let openCount = 0;
  if (to === 'archived') {
    openCount = openItems(await loadEventModel(c.env.DB, eventId, row.feature_site === 1)).length;
    if (openCount > 0 && !acknowledgeOpenItems) {
      throw conflict(`${openCount} attendance records still need reconciliation. Resolve them, or confirm archiving anyway.`);
    }
  }
  const now = nowIso();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE events SET status = ?, updated_at = ?, closed_at = CASE WHEN ? = 'completed' THEN ? WHEN ? = 'open' THEN NULL ELSE closed_at END
        WHERE id = ? AND status = ?`,
    ).bind(to, now, to, now, to, eventId, row.status),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: user.userId },
      action: 'event.transition',
      eventId,
      targetType: 'event',
      targetId: eventId,
      detail: { from: row.status, to, openItemsAcknowledged: openCount },
    }),
  ]);
  if (result[0]!.meta.changes !== 1) throw conflict('The event changed while you were editing. Reload and try again.');
  return c.json({ event: eventDto((await getEventRow(c.env.DB, eventId))!) });
});
