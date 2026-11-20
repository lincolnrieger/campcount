import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import { displayName } from '../../shared/names';
import { dutyInputSchema, dutyPatchSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { getEventRow } from './events';

/**
 * Leader roster: duties (gate, kitchen, first aid…) with a time and place,
 * and the leaders on each. People who can see the roster see it; people who
 * can edit the roster set it. Each leader sees their own duties on their
 * lanyard page (see dutiesFor).
 */
export const dutyRoutes = new Hono<AppEnv>();

const uuid = (value: string | undefined) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

async function requireEditable(c: AppContext, eventId: string) {
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to make changes.');
}

async function dutyRow(c: AppContext, eventId: string, dutyId: string) {
  const row = await c.env.DB.prepare(`SELECT id FROM duties WHERE id = ? AND event_id = ?`).bind(dutyId, eventId).first<{ id: string }>();
  if (!row) throw notFound();
  return row;
}

/** Only active people at this camp can be put on a duty. */
async function checkPeople(c: AppContext, eventId: string, ids: string[]) {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM registrations WHERE event_id = ? AND status = 'active' AND id IN (SELECT value FROM json_each(?))`,
  )
    .bind(eventId, JSON.stringify(unique))
    .all<{ id: string }>();
  if (results.length !== unique.length) throw notFound();
}

dutyRoutes.get('/duties', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.view', { eventId });
  const [duties, people, leaders] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT id, title, location, notes, starts_at, ends_at FROM duties WHERE event_id = ? ORDER BY starts_at, title COLLATE NOCASE`).bind(eventId),
    c.env.DB.prepare(
      `SELECT a.duty_id, r.id, p.first_name, p.preferred_name, p.last_name
         FROM duty_assignments a JOIN duties d ON d.id = a.duty_id
         JOIN registrations r ON r.id = a.registration_id JOIN people p ON p.id = r.person_id
        WHERE d.event_id = ? AND r.status = 'active'
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    ).bind(eventId),
    // Who can be rostered: leaders first (adults and Rovers), then everyone else.
    c.env.DB.prepare(
      `SELECT r.id, r.kind, r.section, r.group_name, p.first_name, p.preferred_name, p.last_name
         FROM registrations r JOIN people p ON p.id = r.person_id
        WHERE r.event_id = ? AND r.status = 'active'
        ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    ).bind(eventId),
  ]);
  type Name = { first_name: string; preferred_name: string; last_name: string };
  const full = (p: Name) => `${p.preferred_name || p.first_name} ${p.last_name}`.trim();
  const byDuty = new Map<string, { registrationId: string; name: string }[]>();
  for (const p of people!.results as (Name & { duty_id: string; id: string })[]) {
    const list = byDuty.get(p.duty_id) ?? [];
    list.push({ registrationId: p.id, name: full(p) });
    byDuty.set(p.duty_id, list);
  }
  return c.json({
    duties: (duties!.results as { id: string; title: string; location: string; notes: string; starts_at: string; ends_at: string | null }[]).map((d) => ({
      id: d.id,
      title: d.title,
      location: d.location,
      notes: d.notes,
      startsAt: d.starts_at,
      endsAt: d.ends_at,
      people: byDuty.get(d.id) ?? [],
    })),
    people: (leaders!.results as (Name & { id: string; kind: string; section: string; group_name: string })[]).map((p) => ({
      id: p.id,
      name: full(p),
      shortName: displayName(p.first_name, p.preferred_name, p.last_name),
      groupName: p.group_name,
      leader: p.kind === 'adult' || /^rover/i.test(p.section),
    })),
  });
});

dutyRoutes.post('/duties', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, dutyInputSchema);
  await requireEditable(c, eventId);
  await checkPeople(c, eventId, input.registrationIds);
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO duties (id, event_id, title, location, notes, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id,
      eventId,
      input.title,
      input.location,
      input.notes,
      input.startsAt,
      input.endsAt,
      now,
      now,
    ),
    ...[...new Set(input.registrationIds)].map((r) => c.env.DB.prepare(`INSERT INTO duty_assignments (duty_id, registration_id, created_at) VALUES (?, ?, ?)`).bind(id, r, now)),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'duty.create', eventId, targetType: 'duty', targetId: id }),
  ]);
  return c.json({ id }, 201);
});

dutyRoutes.patch('/duties/:dutyId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const dutyId = uuid(c.req.param('dutyId'));
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, dutyPatchSchema);
  await requireEditable(c, eventId);
  await dutyRow(c, eventId, dutyId);
  const cols: [string, unknown][] = [
    ['title', input.title],
    ['location', input.location],
    ['notes', input.notes],
    ['starts_at', input.startsAt],
    ['ends_at', input.endsAt],
  ].filter(([, v]) => v !== undefined) as [string, unknown][];
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE duties SET ${cols.map(([k]) => `${k} = ?`).join(', ')}${cols.length ? ', ' : ''}updated_at = ? WHERE id = ? AND event_id = ?`).bind(
      ...cols.map(([, v]) => v),
      nowIso(),
      dutyId,
      eventId,
    ),
    // A start moved past the end would leave a duty ending before it starts.
    c.env.DB.prepare(`UPDATE duties SET ends_at = NULL WHERE id = ? AND ends_at IS NOT NULL AND ends_at <= starts_at`).bind(dutyId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'duty.update', eventId, targetType: 'duty', targetId: dutyId }),
  ]);
  return c.json({ ok: true });
});

dutyRoutes.delete('/duties/:dutyId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const dutyId = uuid(c.req.param('dutyId'));
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  await requireEditable(c, eventId);
  await dutyRow(c, eventId, dutyId);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM duty_assignments WHERE duty_id = ?`).bind(dutyId),
    c.env.DB.prepare(`DELETE FROM duties WHERE id = ? AND event_id = ?`).bind(dutyId, eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'duty.delete', eventId, targetType: 'duty', targetId: dutyId }),
  ]);
  return c.json({ ok: true });
});

dutyRoutes.post('/duties/:dutyId/people', async (c) => {
  const eventId = c.req.param('eventId')!;
  const dutyId = uuid(c.req.param('dutyId'));
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const { registrationId } = await parseBody(c, z.strictObject({ registrationId: z.uuid() }));
  await requireEditable(c, eventId);
  await dutyRow(c, eventId, dutyId);
  await checkPeople(c, eventId, [registrationId]);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO duty_assignments (duty_id, registration_id, created_at) VALUES (?, ?, ?)`).bind(dutyId, registrationId, nowIso()),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'duty.assign', eventId, targetType: 'registration', targetId: registrationId, onlyIfChanged: true }),
  ]);
  return c.json({ ok: true });
});

dutyRoutes.delete('/duties/:dutyId/people/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const dutyId = uuid(c.req.param('dutyId'));
  const registrationId = uuid(c.req.param('registrationId'));
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  await requireEditable(c, eventId);
  await dutyRow(c, eventId, dutyId);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM duty_assignments WHERE duty_id = ? AND registration_id = ?`).bind(dutyId, registrationId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'duty.unassign', eventId, targetType: 'registration', targetId: registrationId, onlyIfChanged: true }),
  ]);
  return c.json({ ok: true });
});

/** One person's duties, soonest first, for their lanyard page. */
export async function dutiesFor(db: D1Database, eventId: string, registrationId: string) {
  const { results } = await db
    .prepare(
      `SELECT d.title, d.location, d.notes, d.starts_at, d.ends_at,
              (SELECT group_concat(name, ', ') FROM (
                 SELECT COALESCE(NULLIF(p.preferred_name, ''), p.first_name) || ' ' || p.last_name AS name
                   FROM duty_assignments o JOIN registrations r ON r.id = o.registration_id JOIN people p ON p.id = r.person_id
                  WHERE o.duty_id = d.id AND o.registration_id <> ? AND r.status = 'active'
                  ORDER BY p.last_name COLLATE NOCASE)) AS others
         FROM duty_assignments a JOIN duties d ON d.id = a.duty_id
        WHERE a.registration_id = ? AND d.event_id = ?
        ORDER BY d.starts_at`,
    )
    .bind(registrationId, registrationId, eventId)
    .all<{ title: string; location: string; notes: string; starts_at: string; ends_at: string | null; others: string | null }>();
  return results.map((d) => ({ title: d.title, location: d.location, notes: d.notes, startsAt: d.starts_at, endsAt: d.ends_at, with: d.others ?? '' }));
}
