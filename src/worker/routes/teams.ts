import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import { teamEventInputSchema, teamEventPatchSchema, teamNameSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { activityAccess, can } from '../services/principal';
import { addMember, createTeam, deleteTeamStatements, loadTeamEvents, removeMember, teamEventRow, teamRow } from '../services/teams';
import { getEventRow } from './events';

/**
 * Team events (Settings live on the Teams tab). Event managers set them up
 * and can change any team; an activity leader assigned to a team event sees
 * its teams and can change them.
 */
export const teamRoutes = new Hono<AppEnv>();

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

/** Event managers, or the team event's own leader (activity.bookings for it). */
function requireTeamEditor(c: AppContext, eventId: string, activityId: string) {
  const principal = requirePrincipal(c);
  if (can(principal, 'activities.manage', { eventId })) return;
  requirePermission(c, 'activity.bookings', { eventId, activityId });
}

teamRoutes.get('/team-events', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'event.view', { eventId });
  const manage = can(principal, 'activities.manage', { eventId });
  const access = manage ? 'all' : activityAccess(principal, 'activity.view_roster', eventId);
  if (access !== 'all' && access.size === 0) throw forbidden();
  return c.json({ teamEvents: await loadTeamEvents(c.env.DB, eventId, access), canManage: manage });
});

teamRoutes.post('/team-events', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, teamEventInputSchema);
  await requireEditable(c, eventId);
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    // The activity people are scanned into. Booking required: being on a team is the booking.
    c.env.DB.prepare(
      `INSERT INTO activities (id, event_id, name, description, location, starts_at, ends_at, track_sign_out, allow_repeat, booking_required, signup_open, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, 0, 'activity', ?, ?)`,
    ).bind(id, eventId, input.name, input.description, input.location, input.startsAt, input.endsAt, now, now),
    c.env.DB.prepare(
      `INSERT INTO team_events (activity_id, event_id, min_size, max_size, max_teams, registration_open, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, eventId, input.minSize, input.maxSize, input.maxTeams, input.registrationOpen ? 1 : 0, now, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'team_event.create', eventId, targetType: 'activity', targetId: id }),
  ]);
  return c.json({ id }, 201);
});

teamRoutes.patch('/team-events/:activityId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const activityId = uuid(c.req.param('activityId'));
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, teamEventPatchSchema);
  await requireEditable(c, eventId);
  const te = await teamEventRow(c.env.DB, eventId, activityId);
  if (!te) throw notFound();
  const minSize = input.minSize ?? te.min_size;
  const maxSize = input.maxSize !== undefined ? input.maxSize : te.max_size;
  if (maxSize !== null && maxSize < minSize) throw conflict('The most per team must be at least the fewest.');

  const activity: [string, unknown][] = (
    [
      ['name', input.name],
      ['description', input.description],
      ['location', input.location],
      ['starts_at', input.startsAt],
      ['ends_at', input.endsAt],
    ] as [string, unknown][]
  ).filter(([, v]) => v !== undefined);
  const settings: [string, unknown][] = (
    [
      ['min_size', input.minSize],
      ['max_size', input.maxSize],
      ['max_teams', input.maxTeams],
      ['registration_open', input.registrationOpen === undefined ? undefined : input.registrationOpen ? 1 : 0],
    ] as [string, unknown][]
  ).filter(([, v]) => v !== undefined);
  const now = nowIso();
  await c.env.DB.batch([
    // Column names come from the fixed lists above, never from the client.
    c.env.DB.prepare(`UPDATE activities SET ${[...activity.map(([k]) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ? AND event_id = ?`).bind(
      ...activity.map(([, v]) => v as string | null),
      now,
      activityId,
      eventId,
    ),
    c.env.DB.prepare(`UPDATE team_events SET ${[...settings.map(([k]) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE activity_id = ? AND event_id = ?`).bind(
      ...settings.map(([, v]) => v as number | null),
      now,
      activityId,
      eventId,
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'team_event.update',
      eventId,
      targetType: 'activity',
      targetId: activityId,
      detail: { fields: Object.keys(input).join(',') },
    }),
  ]);
  return c.json({ ok: true });
});

teamRoutes.post('/team-events/:activityId/teams', async (c) => {
  const eventId = c.req.param('eventId')!;
  const activityId = uuid(c.req.param('activityId'));
  requireTeamEditor(c, eventId, activityId);
  const user = requireUser(c);
  const { name } = await parseBody(c, teamNameSchema);
  await requireEditable(c, eventId);
  const te = await teamEventRow(c.env.DB, eventId, activityId);
  if (!te) throw notFound();
  const id = await createTeam(c.env.DB, eventId, te, name);
  await auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'team.create', eventId, targetType: 'team', targetId: id, detail: { activityId } }).run();
  return c.json({ id }, 201);
});

async function loadTeam(c: AppContext) {
  const eventId = c.req.param('eventId')!;
  const team = await teamRow(c.env.DB, eventId, uuid(c.req.param('teamId')));
  if (!team) throw notFound();
  requireTeamEditor(c, eventId, team.activity_id);
  await requireEditable(c, eventId);
  return { eventId, team, user: requireUser(c) };
}

teamRoutes.patch('/teams/:teamId', async (c) => {
  const { eventId, team, user } = await loadTeam(c);
  const { name } = await parseBody(c, teamNameSchema);
  const taken = await c.env.DB.prepare(`SELECT 1 FROM teams WHERE activity_id = ? AND name = ? COLLATE NOCASE AND id <> ?`).bind(team.activity_id, name, team.id).first();
  if (taken) throw conflict(`There's already a team called ${name}.`);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE teams SET name = ? WHERE id = ?`).bind(name, team.id),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'team.rename', eventId, targetType: 'team', targetId: team.id }),
  ]);
  return c.json({ ok: true });
});

teamRoutes.delete('/teams/:teamId', async (c) => {
  const { eventId, team, user } = await loadTeam(c);
  await c.env.DB.batch([
    ...deleteTeamStatements(c.env.DB, eventId, team.id, team.activity_id),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'team.delete', eventId, targetType: 'team', targetId: team.id, detail: { activityId: team.activity_id } }),
  ]);
  return c.json({ ok: true });
});

teamRoutes.post('/teams/:teamId/members', async (c) => {
  const { eventId, team, user } = await loadTeam(c);
  const { registrationId } = await parseBody(c, z.strictObject({ registrationId: z.uuid() }));
  const te = (await teamEventRow(c.env.DB, eventId, team.activity_id))!;
  await addMember(c.env.DB, eventId, team, te, registrationId, 'manual');
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'team.add_member',
    eventId,
    targetType: 'registration',
    targetId: registrationId,
    detail: { teamId: team.id },
  }).run();
  return c.json({ ok: true });
});

teamRoutes.delete('/teams/:teamId/members/:registrationId', async (c) => {
  const { eventId, team, user } = await loadTeam(c);
  const registrationId = uuid(c.req.param('registrationId'));
  if (!(await removeMember(c.env.DB, eventId, team.id, team.activity_id, registrationId, false))) throw notFound();
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'team.remove_member',
    eventId,
    targetType: 'registration',
    targetId: registrationId,
    detail: { teamId: team.id },
  }).run();
  return c.json({ ok: true });
});
