import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

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

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_self_signup = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [person('100'), person('200'), person('300')] } });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const card = (m: string) => {
    const c = cards.find((x: { name: string }) => x.name.startsWith(`First${m}`));
    return { token: c.qr.split('#')[1] as string, shortCode: c.shortCode as string, registrationId: c.registrationId as string };
  };
  const session = async (name: string, start: string, end: string, capacity: number | null = 2) =>
    (
      await json(
        await api(`/events/${eventId}/activities`, {
          cookie: manager.cookie,
          body: { name, capacity, signupOpen: true, startsAt: `2026-12-05T${start}:00+10:30`, endsAt: `2026-12-05T${end}:00+10:30` },
        }),
      )
    ).id as string;
  const kayak9 = await session('Kayaking', '09:00', '10:30');
  const archery10 = await session('Archery', '10:00', '11:00');
  const kayak11 = await session('Kayaking', '11:00', '12:30', 1);
  await api(`/events/${eventId}/activities`, { cookie: manager.cookie, body: { name: 'Staff only', signupOpen: false } });
  const screen = await json(await api(`/events/${eventId}/signup`, { cookie: manager.cookie }));
  return { eventId, manager, card, kayak9, archery10, kayak11, code: screen.link.split('/signup/')[1] as string };
}

describe('activity sign-up', () => {
  it('shows open sessions with places left, but no names, before anyone scans', async () => {
    const c = await camp();
    const screen = await json(await api(`/public/signup/event/${c.code}`));
    expect(screen.open).toBe(true);
    expect(screen.sessions.map((s: { name: string }) => s.name)).toEqual(['Kayaking', 'Archery', 'Kayaking']);
    expect(JSON.stringify(screen)).not.toContain('First100');
  });

  it('books by scanned lanyard or typed card code, enforcing places and clashes', async () => {
    const c = await camp();
    const me = await json(await api('/public/signup/identify', { body: { token: c.card('100').token, code: c.code } }));
    expect(me.person).toEqual({ name: 'First100 P.', groupName: 'Example Troop' });

    let res = await json(await api('/public/signup/book', { body: { pass: me.pass, activityId: c.kayak9 } }));
    expect(res.bookings.map((b: { activityId: string }) => b.activityId)).toEqual([c.kayak9]);
    const clash = await api('/public/signup/book', { body: { pass: me.pass, activityId: c.archery10 } });
    expect(clash.status).toBe(409);
    expect((await json(clash)).error.message).toMatch(/clashes with Kayaking/);
    res = await json(await api('/public/signup/book', { body: { pass: me.pass, activityId: c.kayak11 } }));
    expect(res.sessions.find((s: { id: string }) => s.id === c.kayak11).full).toBe(true);

    // Someone else, by typed code: the 1-place session is full.
    const other = await json(await api('/public/signup/identify', { body: { shortCode: c.card('200').shortCode.toLowerCase(), code: c.code } }));
    const full = await api('/public/signup/book', { body: { pass: other.pass, activityId: c.kayak11 } });
    expect((await json(full)).error.message).toBe('Kayaking is full.');

    // Cancel frees the place.
    await api('/public/signup/cancel', { body: { pass: me.pass, activityId: c.kayak11 } });
    expect((await api('/public/signup/book', { body: { pass: other.pass, activityId: c.kayak11 } })).status).toBe(200);

    // The event team sees who's booked; the person page lists bookings.
    const list = await json(await api(`/events/${c.eventId}/activities/${c.kayak11}/bookings`, { cookie: c.manager.cookie }));
    expect(list.bookings.map((b: { name: string }) => b.name)).toEqual(['First200 Person']);
    const page = await json(await api(`/events/${c.eventId}/registrations/${c.card('100').registrationId}`, { cookie: c.manager.cookie }));
    expect(page.bookings).toMatchObject([{ name: 'Kayaking', selfBooked: true }]);
  });

  it("works from someone's own lanyard link without the screen code", async () => {
    const c = await camp();
    const me = await json(await api('/public/signup/identify', { body: { token: c.card('300').token } }));
    expect(me.open).toBe(true);
    expect(me.sessions).toHaveLength(3);
  });

  it('refuses unknown cards, cards from other events, closed sign-up, staff-only sessions and stale passes', async () => {
    const c = await camp();
    const other = await camp();
    expect((await api('/public/signup/identify', { body: { shortCode: 'ZZZZ-ZZZZ', code: c.code } })).status).toBe(404);
    expect((await api('/public/signup/identify', { body: { token: other.card('100').token, code: c.code } })).status).toBe(404);
    const me = await json(await api('/public/signup/identify', { body: { token: c.card('100').token } }));
    const staffOnly = (await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie }))).activities.find((a: { name: string }) => a.name === 'Staff only');
    expect((await api('/public/signup/book', { body: { pass: me.pass, activityId: staffOnly.id } })).status).toBe(404);
    expect((await api('/public/signup/book', { body: { pass: me.pass.replace(/.$/, '0'), activityId: c.kayak9 } })).status).toBe(401);

    await testEnv.DB.prepare(`UPDATE events SET feature_self_signup = 0 WHERE id = ?`).bind(c.eventId).run();
    expect((await json(await api(`/public/signup/event/${c.code}`))).open).toBe(false);
    expect((await api('/public/signup/book', { body: { pass: me.pass, activityId: c.kayak9 } })).status).toBe(409);

    await api(`/events/${c.eventId}/signup/new-link`, { cookie: c.manager.cookie, body: {} });
    expect((await api(`/public/signup/event/${c.code}`)).status).toBe(404);
  });

  it('team-made bookings ignore capacity and cannot be cancelled from the sign-up screen', async () => {
    const c = await camp();
    for (const m of ['100', '200']) {
      await api(`/events/${c.eventId}/activities/${c.kayak11}/bookings`, { cookie: c.manager.cookie, body: { registrationId: c.card(m).registrationId } });
    }
    const list = await json(await api(`/events/${c.eventId}/activities/${c.kayak11}/bookings`, { cookie: c.manager.cookie }));
    expect(list.bookings).toHaveLength(2);
    const me = await json(await api('/public/signup/identify', { body: { token: c.card('100').token } }));
    expect(me.bookings[0].canCancel).toBe(false);
    await api('/public/signup/cancel', { body: { pass: me.pass, activityId: c.kayak11 } });
    expect((await json(await api(`/events/${c.eventId}/activities/${c.kayak11}/bookings`, { cookie: c.manager.cookie }))).bookings).toHaveLength(2);
  });
});

describe('stations', () => {
  it('can be renamed, pointed at something else, and reopened with a new pairing code', async () => {
    const c = await camp();
    await api(`/events/${c.eventId}/transition`, { cookie: c.manager.cookie, body: { to: 'open' } });
    const st = await json(await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie, body: { name: 'Lake tablet', contextType: 'activity', contextId: c.kayak9 } }));
    await api(`/events/${c.eventId}/stations/${st.id}`, { cookie: c.manager.cookie, method: 'PATCH', body: { name: 'Range tablet', contextType: 'activity', contextId: c.archery10 } });
    await api(`/events/${c.eventId}/stations/${st.id}`, { cookie: c.manager.cookie, method: 'DELETE' });
    let list = (await json(await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie }))).stations;
    expect(list[0]).toMatchObject({ name: 'Range tablet', contextName: 'Archery', state: 'revoked' });

    const reopened = await json(await api(`/events/${c.eventId}/stations/${st.id}/reopen`, { cookie: c.manager.cookie, body: { hours: 4 } }));
    expect(reopened.pairingCode).toMatch(/^[A-Z0-9]{8}$/);
    list = (await json(await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie }))).stations;
    expect(list[0].state).toBe('waiting');
    const paired = await api('/stations/pair', { body: { code: reopened.pairingCode } });
    expect(paired.status).toBe(200);
  });
});

describe('activity leaders', () => {
  it('see and run only their own activity: roster, check-in and bookings', async () => {
    const c = await camp();
    await api(`/events/${c.eventId}/transition`, { cookie: c.manager.cookie, body: { to: 'open' } });
    const leader = await createUser({ name: 'Kim Kayak' });
    await grant(leader.id, 'activity_leader', c.eventId, c.kayak9);

    const mine = (await json(await api(`/events/${c.eventId}/activities`, { cookie: leader.cookie }))).activities;
    expect(mine.map((a: { id: string }) => a.id)).toEqual([c.kayak9]);

    // Book one person, check another in as a walk-in.
    expect((await api(`/events/${c.eventId}/activities/${c.kayak9}/bookings`, { cookie: leader.cookie, body: { registrationId: c.card('100').registrationId } })).status).toBe(200);
    const scan = await json(
      await api(`/events/${c.eventId}/scans`, {
        cookie: leader.cookie,
        body: {
          deviceId: 'web-roster-test1',
          scans: [{ id: crypto.randomUUID(), contextType: 'activity', contextId: c.kayak9, direction: 'in', deviceTime: new Date().toISOString(), method: 'manual', registrationId: c.card('200').registrationId }],
        },
      }),
    );
    expect(scan.results[0].outcome).toBe('accepted');

    const roster = await json(await api(`/events/${c.eventId}/activities/${c.kayak9}/attendance`, { cookie: leader.cookie }));
    expect(roster).toMatchObject({ canBook: true, canCheckIn: true });
    const by = (m: string) => roster.people.find((p: { id: string }) => p.id === c.card(m).registrationId);
    expect(by('100')).toMatchObject({ name: 'First100 Person', booked: true, visits: 0 });
    expect(by('200')).toMatchObject({ booked: false, visits: 1 });
    expect(roster.everyone).toHaveLength(3);

    // Nothing for other activities, people pages or reports.
    expect((await api(`/events/${c.eventId}/activities/${c.archery10}/attendance`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/activities/${c.archery10}/bookings`, { cookie: leader.cookie, body: { registrationId: c.card('100').registrationId } })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/registrations`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/whereabouts`, { cookie: leader.cookie })).status).toBe(403);
  });
});
