import { describe, expect, it } from 'vitest';
import { api, createActivity, createEvent, createUser, grant, json, testEnv } from './helpers';

const newEvent = { name: 'Summer Camp', startsOn: '2026-12-05', endsOn: '2026-12-07', features: { meals: true } };

async function auditActions(eventId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(`SELECT action FROM audit_log WHERE event_id = ? ORDER BY id`)
    .bind(eventId)
    .all<{ action: string }>();
  return results.map((r) => r.action);
}

describe('events', () => {
  it('only platform users with events.create can create events, and creation is audited', async () => {
    const admin = await createUser({ platformAdmin: true });
    const res = await api('/events', { cookie: admin.cookie, body: newEvent });
    expect(res.status).toBe(201);
    const { event } = await json(res);
    expect(event.status).toBe('draft');
    expect(event.features).toMatchObject({ activities: true, meals: true, dietary: false });
    expect(await auditActions(event.id)).toEqual(['event.create']);

    const nobody = await createUser();
    expect((await api('/events', { cookie: nobody.cookie, body: newEvent })).status).toBe(403);
    expect((await api('/events', { body: newEvent })).status).toBe(401);
  });

  it('validates dates', async () => {
    const admin = await createUser({ platformAdmin: true });
    const res = await api('/events', { cookie: admin.cookie, body: { ...newEvent, endsOn: '2026-12-01' } });
    expect(res.status).toBe(400);
  });

  it('lists only events the caller is assigned to', async () => {
    const admin = await createUser({ platformAdmin: true });
    const e1 = await createEvent(admin.id, { name: 'Mine' });
    const e2 = await createEvent(admin.id, { name: 'Not mine' });
    const director = await createUser();
    await grant(director.id, 'event_manager', e1);

    const { events } = await json(await api('/events', { cookie: director.cookie }));
    const ids = events.map((e: { id: string }) => e.id);
    expect(ids).toContain(e1);
    expect(ids).not.toContain(e2);
  });

  it('answers 404, not 403, for events the caller cannot see', async () => {
    const admin = await createUser({ platformAdmin: true });
    const other = await createEvent(admin.id);
    const director = await createUser();
    await grant(director.id, 'event_manager', await createEvent(admin.id));

    expect((await api(`/events/${other}`, { cookie: director.cookie })).status).toBe(404);
    expect((await api(`/events/${crypto.randomUUID()}`, { cookie: director.cookie })).status).toBe(404);
    expect((await api(`/events/${other}`, { cookie: director.cookie, method: 'PATCH', body: { name: 'pwned' } })).status).toBe(404);
  });

  it('enforces the lifecycle and who may move it', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const director = await createUser();
    const scanner = await createUser();
    await grant(director.id, 'event_manager', eventId);
    await grant(scanner.id, 'scanner', eventId);
    const go = (cookie: string, to: string) => api(`/events/${eventId}/transition`, { cookie, body: { to } });

    expect((await go(director.cookie, 'completed')).status).toBe(409); // draft -> completed not allowed
    expect((await go(scanner.cookie, 'open')).status).toBe(403); // scanners can't publish
    expect((await go(director.cookie, 'open')).status).toBe(200);
    expect((await go(scanner.cookie, 'completed')).status).toBe(403); // or close out
    expect((await go(director.cookie, 'completed')).status).toBe(200);
    expect((await go(director.cookie, 'archived')).status).toBe(403); // archiving is a platform decision
    expect((await go(admin.cookie, 'archived')).status).toBe(200);
    expect((await go(admin.cookie, 'open')).status).toBe(403); // admins hold no close-out rights on events

    // Archived events drop out of event staff access entirely.
    expect((await api(`/events/${eventId}`, { cookie: director.cookie })).status).toBe(404);
    expect(await auditActions(eventId)).toEqual(['event.transition', 'event.transition', 'event.transition']);
  });

  it('blocks configuration changes once an event is completed', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { status: 'completed' });
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    const res = await api(`/events/${eventId}`, { cookie: director.cookie, method: 'PATCH', body: { name: 'New' } });
    expect(res.status).toBe(409);
  });

  it('lets directors toggle features', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    const res = await api(`/events/${eventId}`, {
      cookie: director.cookie,
      method: 'PATCH',
      body: { features: { meals: true, site: true } },
    });
    expect(res.status).toBe(200);
    expect((await json(res)).event.features).toMatchObject({ meals: true, site: true, activities: true });
  });

  it('gives activity leaders view access to their event only', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const activityId = await createActivity(eventId);
    const leader = await createUser();
    await grant(leader.id, 'scanner', eventId, activityId);
    const res = await api(`/events/${eventId}`, { cookie: leader.cookie });
    expect(res.status).toBe(200);
    const { event } = await json(res);
    expect(event.permissions).not.toContain('roster.view');
    expect((await api(`/events/${eventId}`, { cookie: leader.cookie, method: 'PATCH', body: { name: 'x' } })).status).toBe(403);
  });
});
