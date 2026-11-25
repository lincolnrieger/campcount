import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { api, createEvent, createUser, grant, json, testEnv, addPeople } from './helpers';

const person = (participantId: string) => ({
  participantId,
  firstName: `Mover${participantId}`,
  lastName: 'Person',
  kind: 'youth',
});

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const n = String(700000 + Math.floor(Math.random() * 99999));
  await addPeople(eventId, manager.cookie, [person(n)]);
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const add = async (name: string, trackSignOut: boolean) =>
    (await json(await api(`/events/${eventId}/activities`, { cookie: manager.cookie, body: { name, trackSignOut } }))).id as string;
  const kayak = await add('Kayaking', true);
  const archery = await add('Archery', true);
  const craft = await add('Craft', false);
  await api(`/events/${eventId}/transition`, { cookie: manager.cookie, body: { to: 'open' } });
  const card = cards[0] as { registrationId: string; qr: string };
  return { eventId, manager, kayak, archery, craft, registrationId: card.registrationId, token: card.qr.split('#')[1]! };
}

let t = 0;
async function scanIn(c: Awaited<ReturnType<typeof camp>>, activityId: string) {
  const res = await api(`/events/${c.eventId}/scans`, {
    cookie: c.manager.cookie,
    body: {
      deviceId: 'test-device',
      scans: [
        {
          id: crypto.randomUUID(),
          contextType: 'activity',
          contextId: activityId,
          direction: 'in',
          deviceTime: new Date(Date.now() - 600_000 + t++ * 1000).toISOString(),
          method: 'qr',
          credentialHash: await hashToken(c.token),
        },
      ],
    },
  });
  return (await json(res)).results[0] as { outcome: string; warning: string | null };
}

const hereAt = async (c: Awaited<ReturnType<typeof camp>>, activityId: string) =>
  (await json(await api(`/events/${c.eventId}/activities/${activityId}/attendance`, { cookie: c.manager.cookie }))).presentNow as number;

describe('moving between activities', () => {
  it('signs someone out of the activity they were in when they are scanned into another', async () => {
    const c = await camp();
    await scanIn(c, c.kayak);
    expect(await hereAt(c, c.kayak)).toBe(1);
    const second = await scanIn(c, c.archery);
    expect(second.outcome).toBe('accepted');
    expect(second.warning).toMatch(/Signed out of Kayaking automatically/);
    expect(await hereAt(c, c.kayak)).toBe(0);
    expect(await hereAt(c, c.archery)).toBe(1);
    // Activities without sign-out don't hold anyone "here", so nothing to undo there.
    const third = await scanIn(c, c.craft);
    expect(third.warning).toMatch(/Signed out of Archery automatically/);
    // The automatic sign-out is its own scan; nothing was edited.
    const auto = await testEnv.DB.prepare(`SELECT count(*) AS n FROM scans WHERE registration_id = ? AND method = 'correction' AND direction = 'out'`)
      .bind(c.registrationId)
      .first<{ n: number }>();
    expect(auto!.n).toBe(2);
  });

  it('moves a booking to another session in one step', async () => {
    const c = await camp();
    const base = `/events/${c.eventId}/activities`;
    await api(`${base}/${c.kayak}/bookings`, { cookie: c.manager.cookie, body: { registrationId: c.registrationId } });
    const moved = await api(`${base}/${c.kayak}/bookings/${c.registrationId}/move`, { cookie: c.manager.cookie, body: { to: c.archery } });
    expect(moved.status).toBe(200);
    const rows = await testEnv.DB.prepare(`SELECT activity_id FROM activity_bookings WHERE registration_id = ?`).bind(c.registrationId).all<{ activity_id: string }>();
    expect(rows.results.map((r) => r.activity_id)).toEqual([c.archery]);
    // Can't move a booking that isn't there, or move it nowhere.
    expect((await api(`${base}/${c.kayak}/bookings/${c.registrationId}/move`, { cookie: c.manager.cookie, body: { to: c.craft } })).status).toBe(404);
    expect((await api(`${base}/${c.archery}/bookings/${c.registrationId}/move`, { cookie: c.manager.cookie, body: { to: c.archery } })).status).toBe(400);
  });

  it('needs booking rights on both activities', async () => {
    const c = await camp();
    const base = `/events/${c.eventId}/activities`;
    await api(`${base}/${c.kayak}/bookings`, { cookie: c.manager.cookie, body: { registrationId: c.registrationId } });
    const leader = await createUser();
    await grant(leader.id, 'activity_leader', c.eventId, c.kayak);
    expect((await api(`${base}/${c.kayak}/bookings/${c.registrationId}/move`, { cookie: leader.cookie, body: { to: c.archery } })).status).toBe(403);
  });
});
