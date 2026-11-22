import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function withAddress(eventId: string, subdomain: string) {
  await testEnv.DB.prepare(`UPDATE events SET subdomain = ?, brand_color = '#FFCC00' WHERE id = ?`).bind(subdomain, eventId).run();
  return `${subdomain}.campcount.test`;
}

describe('event sites', () => {
  it('the main address is the platform site', async () => {
    expect(await json(await api('/site'))).toMatchObject({ kind: 'platform', rootDomain: 'campcount.test' });
  });

  it("an event's address shows its branding before sign-in, and nothing about other events", async () => {
    const admin = await createUser({ platformAdmin: true });
    const mine = await createEvent(admin.id, { name: 'Summer Camp' });
    const other = await createEvent(admin.id, { name: 'Other Camp' });
    const host = await withAddress(mine, `splash-${mine.slice(0, 6)}`);

    const site = await json(await api('/site', { host }));
    expect(site).toMatchObject({ kind: 'event', event: { id: mine, name: 'Summer Camp', brandColor: '#FFCC00', logoUrl: null } });

    // Even a platform admin only sees this event here.
    const list = await json(await api('/events', { host, cookie: admin.cookie }));
    expect(list.events.map((e: { id: string }) => e.id)).toEqual([mine]);
    expect((await api(`/events/${other}`, { host, cookie: admin.cookie })).status).toBe(404);
    expect((await api(`/events/${other}/registrations`, { host, cookie: admin.cookie })).status).toBe(404);
    expect((await api(`/events/${mine}`, { host, cookie: admin.cookie })).status).toBe(200);
    // No admin area and no creating events on an event's address.
    expect((await api('/admin/users', { host, cookie: admin.cookie })).status).toBe(404);
    expect((await api('/events', { host, cookie: admin.cookie, body: { name: 'X', startsOn: '2026-12-05', endsOn: '2026-12-06' } })).status).toBe(404);
  });

  it('an address no event uses serves nothing but the site lookup', async () => {
    const admin = await createUser({ platformAdmin: true });
    const host = 'nobody-here.campcount.test';
    expect(await json(await api('/site', { host }))).toMatchObject({ kind: 'unknown', subdomain: 'nobody-here' });
    expect((await api('/events', { host, cookie: admin.cookie })).status).toBe(404);
    expect((await api('/me', { host, cookie: admin.cookie })).status).toBe(404);
  });

  it('only platform admins set addresses; they must be valid and unique', async () => {
    const admin = await createUser({ platformAdmin: true });
    const e1 = await createEvent(admin.id);
    const e2 = await createEvent(admin.id);
    const manager = await createUser();
    await grant(manager.id, 'event_manager', e1);
    const sub = `camp-${e1.slice(0, 8)}`;

    expect((await api(`/events/${e1}`, { method: 'PATCH', cookie: manager.cookie, body: { subdomain: sub } })).status).toBe(403);
    expect((await api(`/events/${e1}`, { method: 'PATCH', cookie: manager.cookie, body: { brandColor: '#123456' } })).status).toBe(200);
    expect((await api(`/events/${e1}`, { method: 'PATCH', cookie: admin.cookie, body: { subdomain: 'www' } })).status).toBe(400);
    expect((await api(`/events/${e1}`, { method: 'PATCH', cookie: admin.cookie, body: { subdomain: 'Bad Address!' } })).status).toBe(400);
    const ok = await api(`/events/${e1}`, { method: 'PATCH', cookie: admin.cookie, body: { subdomain: sub } });
    expect(ok.status).toBe(200);
    expect((await json(ok)).event).toMatchObject({ subdomain: sub, brandColor: '#123456' });
    expect((await api(`/events/${e2}`, { method: 'PATCH', cookie: admin.cookie, body: { subdomain: sub } })).status).toBe(400);
  });

  it('accepts real PNG/JPEG/WebP logos only, and serves them on the event address', async () => {
    const admin = await createUser({ platformAdmin: true });
    const id = await createEvent(admin.id);
    const host = await withAddress(id, `logo-${id.slice(0, 8)}`);
    const svg = `data:image/svg+xml;base64,${btoa('<svg onload="alert(1)"/>')}`;
    expect((await api(`/events/${id}/logo`, { method: 'PUT', cookie: admin.cookie, body: { dataUrl: svg } })).status).toBe(400);
    const fake = `data:image/png;base64,${btoa('not really a png')}`;
    expect((await api(`/events/${id}/logo`, { method: 'PUT', cookie: admin.cookie, body: { dataUrl: fake } })).status).toBe(400);
    expect((await api(`/events/${id}/logo`, { method: 'PUT', cookie: admin.cookie, body: { dataUrl: PNG } })).status).toBe(200);

    const site = await json(await api('/site', { host }));
    expect(site.event.logoUrl).toMatch(/^\/api\/site\/logo/);
    const logo = await api('/site/logo', { host });
    expect(logo.status).toBe(200);
    expect(logo.headers.get('Content-Type')).toBe('image/png');

    const stranger = await createUser();
    expect((await api(`/events/${id}/logo`, { method: 'PUT', cookie: stranger.cookie, body: { dataUrl: PNG } })).status).toBe(404);
  });
});

describe("the camp address's front door", () => {
  it('offers the link marked for the camp website, one at a time, only while it is on', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { name: 'Splash' });
    await grant(admin.id, 'event_manager', eventId);
    const host = await withAddress(eventId, `door-${eventId.slice(0, 6)}`);
    const make = async (name: string, features: string[]) =>
      (await json(await api(`/events/${eventId}/participant-links`, { cookie: admin.cookie, body: { name, features } }))).link;
    const everyone = await make('Everyone', ['book']);
    const testing = await make('Testing', ['programme', 'book', 'teams', 'food']);
    const code = (l: { url: string }) => l.url.split('/p/')[1];

    // Nothing marked: no participant door.
    expect((await json(await api('/site', { host }))).event.participantCode).toBeNull();

    const patch = (id: string, body: object) => api(`/events/${eventId}/participant-links/${id}`, { method: 'PATCH', cookie: admin.cookie, body });
    expect((await json(await patch(everyone.id, { home: true }))).link.home).toBe(true);
    expect((await json(await api('/site', { host }))).event.participantCode).toBe(code(everyone));

    // Marking another moves it.
    await patch(testing.id, { home: true });
    const links = (await json(await api(`/events/${eventId}/participant-links`, { cookie: admin.cookie }))).links;
    expect(links.filter((l: { home: boolean }) => l.home).map((l: { id: string }) => l.id)).toEqual([testing.id]);
    expect((await json(await api('/site', { host }))).event.participantCode).toBe(code(testing));

    // Switched off, or the camp closed: no door.
    await patch(testing.id, { active: false });
    expect((await json(await api('/site', { host }))).event.participantCode).toBeNull();
    await patch(testing.id, { active: true });
    await testEnv.DB.prepare(`UPDATE events SET status = 'completed' WHERE id = ?`).bind(eventId).run();
    expect((await json(await api('/site', { host }))).event.participantCode).toBeNull();
  });
});
