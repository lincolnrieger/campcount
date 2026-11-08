import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json } from './helpers';

// A 1×1 PNG: enough for the signature check.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status: 'open' });
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const scanner = await createUser();
  await grant(scanner.id, 'scanner', eventId);
  return { eventId, manager, scanner };
}

describe('lanyard artwork', () => {
  it('uses the built-in design until the event uploads its own, per size and side', async () => {
    const c = await camp();
    const path = `/events/${c.eventId}/lanyard-templates`;
    expect((await json(await api(path, { cookie: c.manager.cookie }))).templates).toEqual([]);

    expect((await api(`${path}/lanyard/front`, { cookie: c.manager.cookie, method: 'PUT', body: { dataUrl: PNG } })).status).toBe(200);
    const { templates } = await json(await api(path, { cookie: c.manager.cookie }));
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ size: 'lanyard', side: 'front' });

    const image = await api(`${path}/lanyard/front`, { cookie: c.manager.cookie });
    expect(image.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())[1]).toBe(0x50);
    expect((await api(`${path}/badge/back`, { cookie: c.manager.cookie })).status).toBe(404);

    expect((await api(`${path}/lanyard/front`, { cookie: c.manager.cookie, method: 'DELETE' })).status).toBe(200);
    expect((await json(await api(path, { cookie: c.manager.cookie }))).templates).toEqual([]);
  });

  it('only takes real PNG or JPEG files, from people who set the event up', async () => {
    const c = await camp();
    const path = `/events/${c.eventId}/lanyard-templates`;
    const fake = `data:image/png;base64,${btoa('<svg onload=alert(1)>')}`;
    expect((await api(`${path}/lanyard/front`, { cookie: c.manager.cookie, method: 'PUT', body: { dataUrl: fake } })).status).toBe(400);
    expect((await api(`${path}/lanyard/front`, { cookie: c.manager.cookie, method: 'PUT', body: { dataUrl: PNG.replace('png', 'webp') } })).status).toBe(400);
    expect((await api(`${path}/poster/front`, { cookie: c.manager.cookie, method: 'PUT', body: { dataUrl: PNG } })).status).toBe(404);
    expect((await api(`${path}/lanyard/front`, { cookie: c.scanner.cookie, method: 'PUT', body: { dataUrl: PNG } })).status).toBe(403);
    expect((await api(path, { cookie: c.scanner.cookie })).status).toBe(403);
  });

  it('remembers whether to print the section band over the artwork', async () => {
    const c = await camp();
    const before = await json(await api(`/events/${c.eventId}`, { cookie: c.manager.cookie }));
    expect(before.event.lanyard.printBand).toBe(true);
    const after = await json(await api(`/events/${c.eventId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { lanyard: { printBand: false } } }));
    expect(after.event.lanyard.printBand).toBe(false);
  });
});
