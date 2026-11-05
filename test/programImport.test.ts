import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

describe('programme import', () => {
  it('adds every activity and meal in one go, or none at all', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    await testEnv.DB.prepare(`UPDATE events SET feature_meals = 1 WHERE id = ?`).bind(eventId).run();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const body = {
      activities: [
        { name: 'Kayaking', startsAt: '2026-12-05T09:00:00+10:30', endsAt: '2026-12-05T10:30:00+10:30', capacity: 12, location: 'Lake' },
        { name: 'Campfire' },
      ],
      meals: [{ name: 'Saturday lunch', startsAt: '2026-12-05T12:00:00+10:30', endsAt: '2026-12-05T13:00:00+10:30' }],
    };
    const res = await api(`/events/${eventId}/program/import`, { cookie: manager.cookie, body });
    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ activities: 2, meals: 1 });
    const { activities } = await json(await api(`/events/${eventId}/activities`, { cookie: manager.cookie }));
    expect(activities.map((a: { name: string }) => a.name).sort()).toEqual(['Campfire', 'Kayaking']);

    // One bad row: nothing is added.
    const bad = { activities: [{ name: 'Ok' }, { name: 'Backwards', startsAt: '2026-12-05T11:00:00+10:30', endsAt: '2026-12-05T10:00:00+10:30' }] };
    expect((await api(`/events/${eventId}/program/import`, { cookie: manager.cookie, body: bad })).status).toBe(400);
    expect((await json(await api(`/events/${eventId}/activities`, { cookie: manager.cookie }))).activities).toHaveLength(2);

    // Scanners can't.
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', eventId);
    expect((await api(`/events/${eventId}/program/import`, { cookie: scanner.cookie, body: { activities: [{ name: 'X' }] } })).status).toBe(403);
  });
});
