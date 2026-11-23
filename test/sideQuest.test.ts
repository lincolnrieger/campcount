import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const row = (memberNumber: string, firstName: string, section: string, kind = 'youth') => ({
  memberNumber,
  firstName,
  preferredName: '',
  lastName: 'Splash',
  kind,
  section,
  groupName: 'Example Troop',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

async function camp(sideQuest = true) {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_self_signup = 1, feature_side_quest = ? WHERE id = ?`).bind(sideQuest ? 1 : 0, eventId).run();
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const base = 800000 + Math.floor(Math.random() * 90000);
  const people = [
    row(String(base + 1), 'Ava', 'Scouts'),
    row(String(base + 2), 'Ben', 'Rovers'),
    row(String(base + 3), 'Cal', 'Rovers'),
    row(String(base + 4), 'Dee', 'Leaders', 'adult'),
    row(String(base + 5), 'Eli', 'Cubs'),
  ];
  await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: people } });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const token = (first: string) => (cards as { name: string; qr: string }[]).find((x) => x.name.startsWith(first))!.qr.split('#')[1]!;
  const code = (await json(await api(`/events/${eventId}/signup`, { cookie: manager.cookie }))).link.split('/signup/')[1] as string;
  return { eventId, manager, token, code };
}

/** One phone: keeps the cookie the server gives it, like a browser. */
function phone() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(v: string) {
      cookie = v;
    },
    async open(token: string, extra: Record<string, unknown> = {}) {
      const res = await api('/public/signup/identify', { body: { token, ...extra }, headers: cookie ? { Cookie: cookie } : {} });
      const set = res.headers.get('Set-Cookie');
      if (set) cookie = set.split(';')[0]!;
      return { status: res.status, body: await json(res), setCookie: set };
    },
  };
}

describe('Super Splash Side Quest', () => {
  it('collects friends on your own phone, counts each once, and ranks you', async () => {
    const c = await camp();
    const ava = phone();
    const own = await ava.open(c.token('Ava'));
    expect(own.body.person.firstName).toBe('Ava');
    expect(own.setCookie).toMatch(/__Host-cc_me=.*HttpOnly.*Secure.*SameSite=Strict/i);
    expect(own.body.sideQuest.collected).toBe(0);

    const first = await ava.open(c.token('Ben'));
    expect(first.body.collect.fresh).toBe(true);
    expect(first.body.collect.friend).toMatchObject({ firstName: 'Ben', sectionWord: 'Rover' });
    expect(first.body.collect.standing).toMatchObject({ collected: 1, total: 4, rank: 1, players: 1 });
    // The friend's own page (bookings, pass) is never shown on someone else's phone.
    expect(first.body.pass).toBeUndefined();

    const again = await ava.open(c.token('Ben'));
    expect(again.body.collect.fresh).toBe(false);
    expect(again.body.collect.standing.collected).toBe(1);

    // Eli collects three people and goes top; Ava drops to 2nd.
    const eli = phone();
    await eli.open(c.token('Eli'));
    for (const f of ['Ava', 'Ben', 'Cal']) await eli.open(c.token(f));
    const back = await ava.open(c.token('Ava'));
    expect(back.body.sideQuest).toMatchObject({ collected: 1, rank: 2, players: 2 });
    expect(back.body.sideQuest.board.map((b: { name: string; place: number; isYou: boolean }) => [b.name, b.place, b.isYou])).toEqual([
      ['Eli S.', 1, false],
      ['Ava S.', 2, true],
    ]);

    // Quests: every Rover, and leaders with the event team.
    const quests = (await eli.open(c.token('Eli'))).body.sideQuest.quests;
    expect(quests.find((q: { key: string }) => q.key === 'rovers')).toMatchObject({ collected: 2, total: 2, done: true });
    expect(quests.find((q: { key: string }) => q.key === 'leaders')).toMatchObject({ label: 'Leaders and the event team', collected: 0, total: 1, done: false });
  });

  it('never collects at the shared sign-up kiosk or with a typed code', async () => {
    const c = await camp();
    const ava = phone();
    await ava.open(c.token('Ava'));
    const kiosk = await api('/public/signup/identify', { body: { token: c.token('Ben'), code: c.code }, headers: { Cookie: ava.cookie } });
    expect((await json(kiosk)).person.firstName).toBe('Ben');
    expect(kiosk.headers.get('Set-Cookie')).toBeNull();
    const n = await testEnv.DB.prepare(`SELECT count(*) AS n FROM side_quest_collections WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('does nothing when the camp has not turned the game on', async () => {
    const c = await camp(false);
    const ava = phone();
    const own = await ava.open(c.token('Ava'));
    expect(own.body.sideQuest).toBeNull();
    const ben = await ava.open(c.token('Ben'));
    // As before: the link shows that card's page, and the phone still belongs to Ava.
    expect(ben.body.person.firstName).toBe('Ben');
    expect(ben.setCookie).toBeNull();
  });

  it('lets someone say "this is my card", and ignores a forged phone cookie', async () => {
    const c = await camp();
    const parent = phone();
    await parent.open(c.token('Ava'));
    const sibling = await parent.open(c.token('Ben'), { claim: true });
    expect(sibling.body.person.firstName).toBe('Ben');
    expect((await parent.open(c.token('Ben'))).body.person.firstName).toBe('Ben');

    const forged = phone();
    forged.cookie = parent.cookie.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'));
    const res = await forged.open(c.token('Cal'));
    expect(res.body.collect).toBeUndefined();
    expect(res.body.person.firstName).toBe('Cal');
  });

  it('gives staff a leaderboard, and nobody else', async () => {
    const c = await camp();
    const ava = phone();
    await ava.open(c.token('Ava'));
    await ava.open(c.token('Ben'));
    await ava.open(c.token('Dee'));
    const board = await json(await api(`/events/${c.eventId}/side-quest`, { cookie: c.manager.cookie }));
    expect(board).toMatchObject({ enabled: true, collections: 2 });
    expect(board.rows[0]).toMatchObject({ name: 'Ava Splash', collected: 2, place: 1 });
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/side-quest`, { cookie: scanner.cookie })).status).toBe(403);
  });

  it('lists who collected whom for staff, and lets managers take collections away and put them back', async () => {
    const c = await camp();
    const ava = phone();
    await ava.open(c.token('Ava'));
    const benCollect = await ava.open(c.token('Ben'));
    expect(benCollect.body.collect.friend.sectionColour).toMatch(/^#[0-9A-F]{6}$/i);
    await ava.open(c.token('Cal'));
    const ben = phone();
    await ben.open(c.token('Ben'));
    await ben.open(c.token('Ava'));

    const list = async () => json(await api(`/events/${c.eventId}/side-quest/collections`, { cookie: c.manager.cookie }));
    const before = await list();
    expect(before).toMatchObject({ enabled: true, canRemove: true });
    expect(before.collections).toHaveLength(3);
    const id = (first: string) => (before.people as { id: string; name: string }[]).find((p) => p.name.startsWith(first))!.id;
    expect(before.people.map((p: { name: string }) => p.name).sort()).toEqual(['Ava Splash', 'Ben Splash', 'Cal Splash']);

    // Take away Ava's collection of Cal, then undo it.
    const res = await json(
      await api(`/events/${c.eventId}/side-quest/collections/remove`, { cookie: c.manager.cookie, body: { pairs: [{ collectorId: id('Ava'), collectedId: id('Cal') }] } }),
    );
    expect(res.removed).toHaveLength(1);
    expect((await list()).collections).toHaveLength(2);
    expect((await api(`/events/${c.eventId}/side-quest/collections/restore`, { cookie: c.manager.cookie, body: { items: res.removed } })).status).toBe(200);
    expect((await list()).collections).toHaveLength(3);
    // Ava's own page counts it again.
    expect((await ava.open(c.token('Ava'), { claim: true })).body.sideQuest.collected).toBe(2);

    // Staff who can only see reports can look but not take away.
    const viewer = await createUser();
    await grant(viewer.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/side-quest/collections`, { cookie: viewer.cookie })).status).toBe(403);
    expect(
      (await api(`/events/${c.eventId}/side-quest/collections/remove`, { cookie: viewer.cookie, body: { pairs: [{ collectorId: id('Ava'), collectedId: id('Ben') }] } })).status,
    ).toBe(403);
  });
});

describe('the phone owner page', () => {
  it('opens the page of whoever the phone belongs to, and nothing without one', async () => {
    const c = await camp();
    const ava = phone();
    await ava.open(c.token('Ava'));
    await ava.open(c.token('Ben'));
    const mine = await api('/public/signup/me', { body: {}, headers: { Cookie: ava.cookie } });
    expect((await json(mine)).person.firstName).toBe('Ava');
    expect((await api('/public/signup/me', { body: {} })).status).toBe(404);
  });
});
