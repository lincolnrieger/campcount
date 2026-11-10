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

  it('saves where the name, leader or youth word, group, QR code and typed code print, per card size', async () => {
    const c = await camp();
    const before = await json(await api(`/events/${c.eventId}`, { cookie: c.manager.cookie }));
    expect(before.event.lanyard.layout).toEqual({ lanyard: null, badge: null });

    const text = (y: number) => ({ show: true, x: 5, y, w: 80, size: 20, colour: '#123ABC', align: 'centre', bold: true });
    const layout = {
      name: text(30),
      role: { ...text(8), adultColour: '#1F4D3F', adultWord: 'Leader', youthWord: 'Youth', youthUsesSection: false },
      group: { ...text(40), bold: false, size: 10 },
      qr: { x: 20, y: 50, size: 50 },
      code: { ...text(108), size: 12 },
    };
    const after = await json(await api(`/events/${c.eventId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { lanyard: { layout: { lanyard: layout, badge: null } } } }));
    expect(after.event.lanyard.layout).toEqual({ lanyard: layout, badge: null });
    // Other lanyard settings are left alone.
    expect(after.event.lanyard.printBand).toBe(true);

    const bad = await api(`/events/${c.eventId}`, {
      cookie: c.manager.cookie,
      method: 'PATCH',
      body: { lanyard: { layout: { lanyard: { ...layout, name: { ...layout.name, colour: 'red' } }, badge: null } } },
    });
    expect(bad.status).toBe(400);
    expect((await api(`/events/${c.eventId}`, { cookie: c.scanner.cookie, method: 'PATCH', body: { lanyard: { layout: { lanyard: null, badge: null } } } })).status).toBe(403);
  });
});
