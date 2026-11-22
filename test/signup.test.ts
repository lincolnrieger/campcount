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

describe('booking links and typed numbers', () => {
  it('books from an emailed link by membership number, saying nothing about who it is', async () => {
    const c = await camp();
    const links = await json(await api(`/events/${c.eventId}/signup/links`, { cookie: c.manager.cookie }));
    expect(links.code).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(links.code).not.toBe(c.code);
    const page = await json(await api(`/public/signup/link/${links.code}/${c.kayak9}`));
    expect(page.session).toMatchObject({ name: 'Kayaking', booked: 0 });
    const res = await api(`/public/signup/link/${links.code}/${c.kayak9}`, { body: { memberNumber: '100' } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.linkResult).toEqual({ booked: true, already: false, activity: 'Kayaking', problem: null });
    // Then their own page, reduced: their bookings (to cancel), first name only.
    expect(body.person).toMatchObject({ firstName: 'First100', lastName: '', groupName: '' });
    expect(body.bookings.map((b: { name: string; canCancel: boolean }) => [b.name, b.canCancel])).toEqual([['Kayaking', true]]);
    const cancelled = await json(await api('/public/signup/cancel', { body: { pass: body.pass, activityId: c.kayak9 } }));
    expect(cancelled.bookings).toEqual([]);
    expect(cancelled.person.lastName).toBe('');
    await api(`/public/signup/link/${links.code}/${c.kayak9}`, { body: { memberNumber: '100' } });
    expect((await json(await api(`/public/signup/link/${links.code}/${c.kayak9}`, { body: { memberNumber: '100' } }))).linkResult).toMatchObject({ already: true });
    // A clash still opens their page, with the reason; an unknown number doesn't.
    const clash = await json(await api(`/public/signup/link/${links.code}/${c.archery10}`, { body: { memberNumber: '100' } }));
    expect(clash.linkResult).toMatchObject({ booked: false, problem: expect.stringMatching(/clashes with Kayaking/) });
    expect((await api(`/public/signup/link/${links.code}/${c.kayak9}`, { body: { memberNumber: '999999' } })).status).toBe(409);
    expect((await api(`/public/signup/link/${c.code}/${c.kayak9}`)).status).toBe(404);
    // New links: the old ones stop working.
    await api(`/events/${c.eventId}/signup/links/new`, { cookie: c.manager.cookie, body: {} });
    expect((await api(`/public/signup/link/${links.code}/${c.kayak9}`)).status).toBe(404);
  });

  it('shows a reduced page for a typed number, and keeps it reduced after booking', async () => {
    const c = await camp();
    const typed = await json(await api('/public/signup/identify', { body: { shortCode: c.card('100').shortCode, code: c.code } }));
    expect(typed.person).toMatchObject({ firstName: 'First100', lastName: '', groupName: '' });
    const after = await json(await api('/public/signup/book', { body: { pass: typed.pass, activityId: c.kayak9 } }));
    expect(after.person).toMatchObject({ lastName: '', groupName: '' });
    // Their own lanyard link shows everything.
    const own = await json(await api('/public/signup/identify', { body: { token: c.card('100').token } }));
    expect(own.person).toMatchObject({ lastName: 'Person', groupName: 'Example Troop' });
  });
});

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
    expect(me.person).toMatchObject({ name: 'First100 P.', firstName: 'First100', groupName: 'Example Troop', sectionWord: 'Scout' });

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
    expect((await api('/public/signup/book', { body: { pass: me.pass.replace(/.$/, (ch: string) => (ch === '0' ? '1' : '0')), activityId: c.kayak9 } })).status).toBe(401);

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

    // Undo the walk-in's check-in: they're back to not here, and the scan is voided, not deleted.
    const reset = await json(await api(`/events/${c.eventId}/activities/${c.kayak9}/attendance/${c.card('200').registrationId}/reset`, { cookie: leader.cookie, method: 'POST' }));
    expect(reset).toEqual({ undone: 1 });
    const after = await json(await api(`/events/${c.eventId}/activities/${c.kayak9}/attendance`, { cookie: leader.cookie }));
    expect(after.people.find((p: { id: string }) => p.id === c.card('200').registrationId)).toBeUndefined();
    expect(await json(await api(`/events/${c.eventId}/activities/${c.kayak9}/attendance/${c.card('200').registrationId}/reset`, { cookie: leader.cookie, method: 'POST' }))).toEqual({ undone: 0 });
    expect((await api(`/events/${c.eventId}/activities/${c.archery10}/attendance/${c.card('200').registrationId}/reset`, { cookie: leader.cookie, method: 'POST' })).status).toBe(403);

    // Nothing for other activities, people pages or reports.
    expect((await api(`/events/${c.eventId}/activities/${c.archery10}/attendance`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/activities/${c.archery10}/bookings`, { cookie: leader.cookie, body: { registrationId: c.card('100').registrationId } })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/registrations`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/whereabouts`, { cookie: leader.cookie })).status).toBe(403);
  });
});

describe("someone's own lanyard page", () => {
  it('shows places taken on activities and each meal with its menu and ingredients', async () => {
    const c = await camp();
    await testEnv.DB.prepare(`UPDATE events SET feature_meals = 1 WHERE id = ?`).bind(c.eventId).run();
    const meal = await api(`/events/${c.eventId}/meals`, {
      cookie: c.manager.cookie,
      body: { name: 'Saturday dinner', startsAt: '2026-12-05T17:30:00+10:30', menu: 'Spaghetti bolognese', ingredients: 'Wheat pasta, beef, tomato, onion' },
    });
    expect(meal.status).toBe(201);
    const { meals } = await json(await api(`/events/${c.eventId}/meals`, { cookie: c.manager.cookie }));
    expect(meals[0]).toMatchObject({ menu: 'Spaghetti bolognese', ingredients: 'Wheat pasta, beef, tomato, onion' });

    await api(`/public/signup/identify`, { body: { token: c.card('200').token } }).then(json).then((v) => api('/public/signup/book', { body: { pass: v.pass, activityId: c.kayak9 } }));
    const view = await json(await api(`/public/signup/identify`, { body: { token: c.card('100').token } }));
    const items = view.programme as { name: string; kind: string; capacity: number | null; booked: number; menu?: string; ingredients?: string }[];
    expect(items.find((i) => i.kind === 'meal')).toMatchObject({ name: 'Saturday dinner', menu: 'Spaghetti bolognese', ingredients: 'Wheat pasta, beef, tomato, onion' });
    expect(items.find((i) => i.name === 'Kayaking' && i.capacity === 2)).toMatchObject({ booked: 1 });
    expect(items.some((i) => 'bookingRequired' in i)).toBe(false);
  });
});

describe('participant links', () => {
  it('lists each person with the same link as their lanyard, for event managers only, and audits it', async () => {
    const c = await camp();
    const { links } = await json(await api(`/events/${c.eventId}/credentials/links`, { cookie: c.manager.cookie, body: {} }));
    expect(links).toHaveLength(3);
    const first = links.find((l: { name: string }) => l.name.startsWith('First100'));
    expect(first.link.split('#')[1]).toBe(c.card('100').token);
    const audit = await testEnv.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE event_id = ? AND action = 'credentials.links'`).bind(c.eventId).first<{ n: number }>();
    expect(audit?.n).toBe(1);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/credentials/links`, { cookie: scanner.cookie, body: {} })).status).toBe(403);
  });
});

describe('a lost lanyard', () => {
  it('stops its sign-up pass working as soon as the lanyard is replaced', async () => {
    const c = await camp();
    const me = await json(await api('/public/signup/identify', { body: { token: c.card('100').token } }));
    expect((await api('/public/signup/book', { body: { pass: me.pass, activityId: c.kayak9 } })).status).toBe(200);
    await api(`/events/${c.eventId}/credentials/issue`, {
      cookie: c.manager.cookie,
      body: { mode: 'replace', registrationIds: [c.card('100').registrationId] },
    });
    expect((await api('/public/signup/cancel', { body: { pass: me.pass, activityId: c.kayak9 } })).status).toBe(401);
  });
});

describe('links for everyone', () => {
  it('opens a typed-number page with only the parts the link switches on, and refuses the rest', async () => {
    const c = await camp();
    const make = async (name: string, features: string[]) =>
      (await json(await api(`/events/${c.eventId}/participant-links`, { cookie: c.manager.cookie, body: { name, features } }))).link as {
        id: string;
        url: string;
        features: string[];
      };
    const bookOnly = await make('Book only', ['book']);
    const lookOnly = await make('Look only', ['programme', 'food']);
    expect(bookOnly.url).toMatch(/\/p\/[A-Za-z0-9_-]{10,}$/);
    const code = (l: { url: string }) => l.url.split('/p/')[1];

    // Before a number: the camp and what the link does, nothing about anyone.
    const info = await json(await api(`/public/signup/p/${code(bookOnly)}`));
    expect(info.features).toEqual(['book']);
    expect(JSON.stringify(info)).not.toContain('First100');

    // A booking-only page: sessions to book, no programme or teams; a reduced page (no surname or group).
    const view = await json(await api(`/public/signup/p/${code(bookOnly)}`, { body: { memberNumber: '100' } }));
    expect(view.features).toEqual(['book']);
    expect(view.sessions.length).toBe(3);
    expect(view.programme).toEqual([]);
    expect(view.person).toMatchObject({ firstName: 'First100', lastName: '', groupName: '' });
    const booked = await api('/public/signup/book', { body: { pass: view.pass, activityId: c.kayak9 } });
    expect(booked.status).toBe(200);
    expect((await json(booked)).bookings[0]).toMatchObject({ name: 'Kayaking', canCancel: true });
    expect((await api('/public/signup/meals', { body: { pass: view.pass } })).status).toBe(403);

    // A look-only page can't book or cancel, even with a hand-made request.
    const look = await json(await api(`/public/signup/p/${code(lookOnly)}`, { body: { memberNumber: '100' } }));
    expect(look.sessions).toEqual([]);
    expect(look.bookings[0]).toMatchObject({ name: 'Kayaking', canCancel: false });
    expect((await api('/public/signup/book', { body: { pass: look.pass, activityId: c.archery10 } })).status).toBe(403);
    expect((await api('/public/signup/cancel', { body: { pass: look.pass, activityId: c.kayak9 } })).status).toBe(403);
    // The pass can't be edited to switch more on.
    const forged = look.pass.replace(/\.r\d+\./, '.r15.');
    expect((await api('/public/signup/book', { body: { pass: forged, activityId: c.archery10 } })).status).toBe(401);

    // Refreshing reopens the same page from its pass; a lanyard's own pass can't be used this way.
    const again = await json(await api('/public/signup/view', { body: { pass: look.pass } }));
    expect(again.features).toEqual(['programme', 'food']);
    const own = await json(await api('/public/signup/identify', { body: { token: c.card('200').token } }));
    expect(own.features).toEqual(['programme', 'book', 'teams', 'food']);
    expect((await api('/public/signup/view', { body: { pass: own.pass } })).status).toBe(401);

    // Unknown numbers, switched-off and deleted links.
    expect((await api(`/public/signup/p/${code(bookOnly)}`, { body: { memberNumber: '999' } })).status).toBe(409);
    await api(`/events/${c.eventId}/participant-links/${bookOnly.id}`, { method: 'PATCH', cookie: c.manager.cookie, body: { active: false } });
    expect((await api(`/public/signup/p/${code(bookOnly)}`)).status).toBe(404);
    const fresh = await json(await api(`/events/${c.eventId}/participant-links/${lookOnly.id}/new-code`, { cookie: c.manager.cookie, body: {} }));
    expect((await api(`/public/signup/p/${code(lookOnly)}`)).status).toBe(404);
    expect((await api(`/public/signup/p/${code(fresh.link)}`)).status).toBe(200);
    await api(`/events/${c.eventId}/participant-links/${lookOnly.id}`, { method: 'DELETE', cookie: c.manager.cookie });
    expect((await json(await api(`/events/${c.eventId}/participant-links`, { cookie: c.manager.cookie }))).links.length).toBe(1);
  });

  it('is for event managers only', async () => {
    const c = await camp();
    const other = await createUser();
    expect([403, 404]).toContain((await api(`/events/${c.eventId}/participant-links`, { cookie: other.cookie })).status);
    expect((await api(`/events/${c.eventId}/participant-links`, { cookie: c.manager.cookie, body: { name: 'X', features: [] } })).status).toBe(400);
  });
});
