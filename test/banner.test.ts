import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, addPeople } from './helpers';

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const person = (participantId: string, kind: 'youth' | 'adult') => ({
  participantId,
  firstName: `P${participantId}`,
  lastName: 'Person',
  kind,
});

describe('participant page banner', () => {
  it('is uploaded by the event team and shown on participants’ pages', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { status: 'open' });
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    await addPeople(eventId, manager.cookie, [person('100', 'youth')]);
    await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
    const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
    const token = cards[0].qr.split('#')[1];

    expect((await json(await api('/public/signup/identify', { body: { token } }))).event.banner).toBeNull();

    const svg = await api(`/events/${eventId}/banner`, { cookie: manager.cookie, method: 'PUT', body: { dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', width: 1, height: 1 } });
    expect(svg.status).toBe(400);
    const fake = await api(`/events/${eventId}/banner`, { cookie: manager.cookie, method: 'PUT', body: { dataUrl: 'data:image/png;base64,AAAAAAAAAAAA', width: 1, height: 1 } });
    expect(fake.status).toBe(400);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', eventId);
    expect((await api(`/events/${eventId}/banner`, { cookie: scanner.cookie, method: 'PUT', body: { dataUrl: PNG, width: 1, height: 1 } })).status).toBe(403);

    const saved = await json(await api(`/events/${eventId}/banner`, { cookie: manager.cookie, method: 'PUT', body: { dataUrl: PNG, width: 1, height: 1 } }));
    expect(saved.banner.url).toMatch(new RegExp(`^/api/public/banner/${eventId}\\?v=`));

    const view = await json(await api('/public/signup/identify', { body: { token } }));
    expect(view.event.banner).toEqual(saved.banner);

    const img = await api(saved.banner.url.replace(/^\/api/, ''));
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');

    await api(`/events/${eventId}/banner`, { cookie: manager.cookie, method: 'DELETE' });
    expect((await json(await api('/public/signup/identify', { body: { token } }))).event.banner).toBeNull();
    expect((await api(`/public/banner/${eventId}`)).status).toBe(404);
  });
});
