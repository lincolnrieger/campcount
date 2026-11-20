import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

/**
 * Camp-scale behaviour: hundreds of phones behind one internet address, and
 * many people pressing the same button at the same moment.
 */

const CAMP_WIFI = { 'CF-Connecting-IP': '203.0.113.7' };

const person = (memberNumber: string) => ({
  memberNumber,
  firstName: `First${memberNumber}`,
  preferredName: '',
  lastName: 'Person',
  kind: 'youth',
  section: 'Scouts',
  groupName: 'Example Troop',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

async function camp(people: number, capacity: number) {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_self_signup = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const rows = Array.from({ length: people }, (_, i) => person(String(1000 + i)));
  await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows } });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const activity = (
    await json(
      await api(`/events/${eventId}/activities`, {
        cookie: manager.cookie,
        body: { name: 'Kayaking', capacity, signupOpen: true, startsAt: '2026-12-05T09:00:00+10:30', endsAt: '2026-12-05T10:30:00+10:30' },
      }),
    )
  ).id as string;
  const tokens = (cards as { qr: string }[]).map((c) => c.qr.split('#')[1] as string);
  return { eventId, manager, activity, tokens };
}

describe('a whole camp at once', () => {
  it('lets 60 participants on one camp Wi-Fi identify and book in the same minute', async () => {
    const c = await camp(60, null as unknown as number);
    const results = await Promise.all(
      c.tokens.map(async (token) => {
        const me = await api('/public/signup/identify', { body: { token }, headers: CAMP_WIFI });
        if (me.status !== 200) return me.status;
        const { pass } = await json(me);
        return (await api('/public/signup/book', { body: { pass, activityId: c.activity }, headers: CAMP_WIFI })).status;
      }),
    );
    expect(results.filter((s) => s !== 200)).toEqual([]);
  });

  it('still limits one person making lots of changes', async () => {
    const c = await camp(1, 5);
    const { pass } = await json(await api('/public/signup/identify', { body: { token: c.tokens[0] }, headers: CAMP_WIFI }));
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const path = i % 2 === 0 ? '/public/signup/book' : '/public/signup/cancel';
      statuses.push((await api(path, { body: { pass, activityId: c.activity }, headers: CAMP_WIFI })).status);
    }
    expect(statuses).toContain(429);
  });

  it('never overbooks: 40 people racing for 10 places get exactly 10', async () => {
    const c = await camp(40, 10);
    const passes = await Promise.all(
      c.tokens.map(async (token) => (await json(await api('/public/signup/identify', { body: { token } }))).pass as string),
    );
    const statuses = await Promise.all(passes.map((pass) => api('/public/signup/book', { body: { pass, activityId: c.activity } }).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(30);
    const row = await testEnv.DB.prepare(`SELECT count(*) AS n FROM activity_bookings WHERE activity_id = ?`).bind(c.activity).first<{ n: number }>();
    expect(row?.n).toBe(10);
  });

  it('counts the same booking once when it is sent 10 times at once', async () => {
    const c = await camp(1, 5);
    const { pass } = await json(await api('/public/signup/identify', { body: { token: c.tokens[0] } }));
    await Promise.all(Array.from({ length: 10 }, () => api('/public/signup/book', { body: { pass, activityId: c.activity } })));
    const row = await testEnv.DB.prepare(`SELECT count(*) AS n FROM activity_bookings WHERE activity_id = ?`).bind(c.activity).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});

describe('the live dashboard', () => {
  it('shows a new arrival straight away, even though dashboards are reused for a few seconds', async () => {
    const c = await camp(2, 5);
    await testEnv.DB.prepare(`UPDATE events SET feature_site = 1 WHERE id = ?`).bind(c.eventId).run();
    await api(`/events/${c.eventId}/transition`, { cookie: c.manager.cookie, body: { to: 'open' } });
    const where = async () => (await json(await api(`/events/${c.eventId}/whereabouts`, { cookie: c.manager.cookie }))).people as { id: string; site: string | null }[];
    const before = await where();
    const someone = before[0]!;
    expect(someone.site).not.toBe('on');
    const up = await api(`/events/${c.eventId}/scans`, {
      cookie: c.manager.cookie,
      body: {
        deviceId: 'test-device',
        scans: [{ id: crypto.randomUUID(), contextType: 'site', contextId: null, direction: 'in', deviceTime: new Date().toISOString(), method: 'manual', registrationId: someone.id }],
      },
    });
    expect(up.status).toBe(200);
    expect((await where()).find((p) => p.id === someone.id)!.site).toBe('on');
  });
});
