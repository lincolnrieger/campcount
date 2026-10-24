import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import { activityInputSchema, activityPatchSchema, mealInputSchema, mealPatchSchema, stationInputSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addMinutes, nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { randomShortCode } from '../services/credentials';
import { sha256Hex } from '../lib/crypto';
import { activityAccess, can } from '../services/principal';
import { loadContext } from '../services/contexts';
import { getEventRow } from './events';

export const operationsRoutes = new Hono<AppEnv>();

async function requireEditable(c: AppContext, eventId: string) {
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to make changes.');
  return event;
}

const uuidParam = (value: string | undefined) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

// ---------------------------------------------------------------- activities

function activityDto(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    location: r.location,
    instructions: r.instructions,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    capacity: r.capacity,
    capacityPolicy: r.capacity_policy,
    trackSignOut: r.track_sign_out === 1,
    allowRepeat: r.allow_repeat === 1,
    bookingRequired: r.booking_required === 1,
    signupOpen: r.signup_open === 1,
    status: r.status,
  };
}

operationsRoutes.get('/activities', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'event.view', { eventId });
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM activities WHERE event_id = ? ORDER BY starts_at IS NULL, starts_at, name COLLATE NOCASE`,
  )
    .bind(eventId)
    .all<Record<string, unknown>>();
  const manage = can(principal, 'activities.manage', { eventId });
  const access = activityAccess(principal, 'activity.scan', eventId);
  const visible = results.filter((r) => manage || access === 'all' || access.has(r.id as string));
  return c.json({ activities: visible.map(activityDto) });
});

const ACTIVITY_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  location: 'location',
  instructions: 'instructions',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  capacity: 'capacity',
  capacityPolicy: 'capacity_policy',
  trackSignOut: 'track_sign_out',
  allowRepeat: 'allow_repeat',
  bookingRequired: 'booking_required',
  status: 'status',
};

const toDb = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));

operationsRoutes.post('/activities', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, activityInputSchema);
  await requireEditable(c, eventId);
  const id = crypto.randomUUID();
  const now = nowIso();
  const cols = Object.keys(ACTIVITY_COLUMNS).filter((k) => k !== 'status' && k in input);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO activities (id, event_id, ${cols.map((k) => ACTIVITY_COLUMNS[k]).join(', ')}, created_at, updated_at)
       VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
    ).bind(id, eventId, ...cols.map((k) => toDb(input[k as keyof typeof input])), now, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'activity.create', eventId, targetType: 'activity', targetId: id }),
  ]);
  return c.json({ id }, 201);
});

operationsRoutes.patch('/activities/:activityId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const activityId = uuidParam(c.req.param('activityId'));
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, activityPatchSchema);
  await requireEditable(c, eventId);
  const keys = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  if (keys.length === 0) return c.json({ ok: true });
  const [update] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE activities SET ${keys.map((k) => `${ACTIVITY_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND event_id = ?`,
    ).bind(...keys.map((k) => toDb(input[k as keyof typeof input])), nowIso(), activityId, eventId),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: user.userId },
      action: 'activity.update',
      eventId,
      targetType: 'activity',
      targetId: activityId,
      detail: { fields: keys.join(',') },
    }),
  ]);
  if (update!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- meals

operationsRoutes.get('/meals', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePrincipal(c);
  if (!can(principal, 'meal.scan', { eventId }) && !can(principal, 'meals.manage', { eventId })) {
    requirePermission(c, 'meals.manage', { eventId });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, location, starts_at, ends_at, status FROM meal_services WHERE event_id = ?
      ORDER BY starts_at IS NULL, starts_at, name COLLATE NOCASE`,
  )
    .bind(eventId)
    .all<Record<string, unknown>>();
  return c.json({
    meals: results.map((m) => ({ id: m.id, name: m.name, location: m.location, startsAt: m.starts_at, endsAt: m.ends_at, status: m.status })),
  });
});

operationsRoutes.post('/meals', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'meals.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, mealInputSchema);
  await requireEditable(c, eventId);
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO meal_services (id, event_id, name, location, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, eventId, input.name, input.location, input.startsAt, input.endsAt, now, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal.create', eventId, targetType: 'meal', targetId: id }),
  ]);
  return c.json({ id }, 201);
});

operationsRoutes.patch('/meals/:mealId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = uuidParam(c.req.param('mealId'));
  requirePermission(c, 'meals.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, mealPatchSchema);
  await requireEditable(c, eventId);
  const map: Record<string, string> = { name: 'name', location: 'location', startsAt: 'starts_at', endsAt: 'ends_at', status: 'status' };
  const keys = Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined);
  if (keys.length === 0) return c.json({ ok: true });
  const [update] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE meal_services SET ${keys.map((k) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND event_id = ?`).bind(
      ...keys.map((k) => (input[k as keyof typeof input] ?? null) as string | null),
      nowIso(),
      mealId,
      eventId,
    ),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: user.userId },
      action: 'meal.update',
      eventId,
      targetType: 'meal',
      targetId: mealId,
      detail: { fields: keys.join(',') },
    }),
  ]);
  if (update!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- stations

const PAIRING_MINUTES = 15;

operationsRoutes.get('/stations', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'stations.manage', { eventId });
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.context_type, s.context_id, s.paired_at, s.expires_at, s.revoked_at, s.pairing_expires_at,
            COALESCE(a.name, m.name, 'On site') AS context_name
       FROM stations s
       LEFT JOIN activities a ON a.id = s.context_id AND s.context_type = 'activity'
       LEFT JOIN meal_services m ON m.id = s.context_id AND s.context_type = 'meal'
      WHERE s.event_id = ? ORDER BY s.created_at DESC`,
  )
    .bind(eventId)
    .all<Record<string, string | null>>();
  const now = nowIso();
  return c.json({
    stations: results.map((s) => ({
      id: s.id,
      name: s.name,
      contextType: s.context_type,
      contextName: s.context_name,
      state: s.revoked_at
        ? 'revoked'
        : s.expires_at! <= now
          ? 'expired'
          : s.paired_at
            ? 'active'
            : s.pairing_expires_at! > now
              ? 'waiting'
              : 'pairing_expired',
      pairedAt: s.paired_at,
      expiresAt: s.expires_at,
    })),
  });
});

operationsRoutes.post('/stations', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'stations.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, stationInputSchema);
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (event.status !== 'open') throw conflict('Open the event before setting up scanning stations.');
  if ((input.contextType === 'site') !== (input.contextId === null)) throw badRequest('Choose what this station scans.');
  await loadContext(c.env.DB, eventId, input.contextType, input.contextId);

  const id = crypto.randomUUID();
  const code = randomShortCode();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO stations (id, event_id, name, context_type, context_id, pairing_code_hash, pairing_expires_at, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      eventId,
      input.name,
      input.contextType,
      input.contextId,
      await sha256Hex(`pair:${code}`),
      addMinutes(now, PAIRING_MINUTES),
      addMinutes(now, input.hours * 60),
      user.userId,
      now,
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'station.create',
      eventId,
      targetType: 'station',
      targetId: id,
      detail: { contextType: input.contextType, contextId: input.contextId, hours: input.hours },
    }),
  ]);
  return c.json({ id, pairingCode: code, pairingExpiresAt: addMinutes(now, PAIRING_MINUTES) }, 201);
});

operationsRoutes.delete('/stations/:stationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const stationId = uuidParam(c.req.param('stationId'));
  requirePermission(c, 'stations.manage', { eventId });
  const user = requireUser(c);
  const now = nowIso();
  const [update] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE stations SET revoked_at = ?, pairing_code_hash = NULL WHERE id = ? AND event_id = ? AND revoked_at IS NULL`).bind(
      now,
      stationId,
      eventId,
    ),
    c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE station_id = ? AND revoked_at IS NULL`).bind(now, stationId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'station.revoke', eventId, targetType: 'station', targetId: stationId }),
  ]);
  if (update!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- deleting activities and meals

/**
 * Delete an activity or meal outright, with every scan recorded for it.
 * Cancelling keeps the records; deleting is for mistakes and test data.
 * Stations set up for it are stopped. The audit log keeps the name and how
 * many scans went with it.
 */
async function deleteContext(c: AppContext, type: 'activity' | 'meal', id: string) {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, type === 'activity' ? 'activities.manage' : 'meals.manage', { eventId });
  const user = requireUser(c);
  await requireEditable(c, eventId);
  const table = type === 'activity' ? 'activities' : 'meal_services';
  const row = await c.env.DB.prepare(`SELECT name FROM ${table} WHERE id = ? AND event_id = ?`).bind(id, eventId).first<{ name: string }>();
  if (!row) throw notFound();
  const counted = await c.env.DB.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ? AND context_type = ? AND context_id = ?`)
    .bind(eventId, type, id)
    .first<{ n: number }>();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND station_id IN (SELECT id FROM stations WHERE event_id = ? AND context_type = ? AND context_id = ?)`,
    ).bind(now, eventId, type, id),
    c.env.DB.prepare(`UPDATE stations SET revoked_at = COALESCE(revoked_at, ?) WHERE event_id = ? AND context_type = ? AND context_id = ?`).bind(now, eventId, type, id),
    c.env.DB.prepare(`DELETE FROM scans WHERE event_id = ? AND context_type = ? AND context_id = ?`).bind(eventId, type, id),
    c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND event_id = ?`).bind(id, eventId),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: `${type}.delete`,
      eventId,
      targetType: type,
      targetId: id,
      detail: { name: row.name, scans: counted?.n ?? 0 },
    }),
  ]);
  return c.json({ ok: true, scans: counted?.n ?? 0 });
}

operationsRoutes.delete('/activities/:activityId', (c) => deleteContext(c, 'activity', uuidParam(c.req.param('activityId'))));
operationsRoutes.delete('/meals/:mealId', (c) => deleteContext(c, 'meal', uuidParam(c.req.param('mealId'))));

/** How many scans an activity or meal has, so the app can warn before deleting. */
operationsRoutes.get('/:type{activities|meals}/:id/scan-count', async (c) => {
  const eventId = c.req.param('eventId')!;
  const type = c.req.param('type') === 'activities' ? 'activity' : 'meal';
  requirePermission(c, type === 'activity' ? 'activities.manage' : 'meals.manage', { eventId });
  const row = await c.env.DB.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ? AND context_type = ? AND context_id = ?`)
    .bind(eventId, type, uuidParam(c.req.param('id')))
    .first<{ n: number }>();
  return c.json({ scans: row?.n ?? 0 });
});
