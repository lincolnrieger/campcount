import { describe, expect, it } from 'vitest';
import { starterDesign } from '../src/shared/lanyardDesign';
import type { LanyardDesign } from '../src/shared/lanyardDesign';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function camp(status = 'open') {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status });
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const scanner = await createUser();
  await grant(scanner.id, 'scanner', eventId);
  return { eventId, manager, scanner, path: `/events/${eventId}` };
}

const withImage = (d: LanyardDesign, assetId: string): LanyardDesign => ({
  ...d,
  back: { ...d.back, elements: [...d.back.elements, { id: 'logo-1', type: 'image', assetId, x: 10, y: 10, w: 20, h: 20, fit: 'contain', radius: 0, opacity: 1 }] },
});

describe('lanyard designer storage', () => {
  it('starts empty, then saves and returns the design', async () => {
    const c = await camp();
    expect(await json(await api(`${c.path}/lanyard-design`, { cookie: c.manager.cookie }))).toEqual({ design: null, updatedAt: null });
    const design = starterDesign('cr80', 'landscape');
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design } })).status).toBe(200);
    const back = await json(await api(`${c.path}/lanyard-design`, { cookie: c.manager.cookie }));
    expect(back.design).toEqual(design);
    // Many autosaves make one audit line.
    await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design } });
    const audits = await testEnv.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE event_id = ? AND action = 'lanyard.design'`).bind(c.eventId).first<{ n: number }>();
    expect(audits!.n).toBe(1);
  });

  it('refuses broken designs and people who only scan', async () => {
    const c = await camp();
    const design = starterDesign();
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.scanner.cookie, body: { design } })).status).toBe(403);
    expect((await api(`${c.path}/lanyard-design`, { cookie: c.scanner.cookie })).status).toBe(403);
    const bad = { ...design, front: { ...design.front, background: 'red' } };
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: bad } })).status).toBe(400);
    const dupe = { ...design, back: { ...design.back, elements: [...design.back.elements, design.front.elements[0]!] } };
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: dupe } })).status).toBe(400);
    const largeLandscape = { ...starterDesign('large'), orientation: 'landscape' };
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: largeLandscape } })).status).toBe(400);
  });

  it("can't be changed once the camp is closed", async () => {
    const c = await camp('completed');
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: starterDesign() } })).status).toBe(409);
  });

  it('takes real images only, and only uses this camp’s images', async () => {
    const c = await camp();
    const other = await camp();
    const fake = `data:image/png;base64,${btoa('<svg onload=alert(1)>')}`;
    expect((await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: fake } })).status).toBe(400);
    expect((await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status).toBe(400);
    expect((await api(`${c.path}/lanyard-assets`, { cookie: c.scanner.cookie, body: { dataUrl: PNG } })).status).toBe(403);

    const up = await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: PNG } });
    expect(up.status).toBe(201);
    const { id, url } = await json(up);
    const img = await api(url.replace('/api', ''), { cookie: c.manager.cookie });
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(img.headers.get('X-Content-Type-Options')).toBe('nosniff');

    // Another camp can't see it or put it on its own design.
    expect((await api(`${other.path}/lanyard-assets/${id}`, { cookie: other.manager.cookie })).status).toBe(404);
    expect((await api(`${other.path}/lanyard-design`, { method: 'PUT', cookie: other.manager.cookie, body: { design: withImage(starterDesign(), id) } })).status).toBe(400);
    expect((await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: withImage(starterDesign(), id) } })).status).toBe(200);
  });

  it('clears images taken off the design after a day, keeping ones still used', async () => {
    const c = await camp();
    const kept = (await json(await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: PNG } }))).id;
    const dropped = (await json(await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: PNG } }))).id;
    const fresh = (await json(await api(`${c.path}/lanyard-assets`, { cookie: c.manager.cookie, body: { dataUrl: PNG } }))).id;
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await testEnv.DB.prepare(`UPDATE lanyard_assets SET created_at = ? WHERE id IN (?, ?)`).bind(old, kept, dropped).run();
    await api(`${c.path}/lanyard-design`, { method: 'PUT', cookie: c.manager.cookie, body: { design: withImage(starterDesign(), kept) } });
    const { results } = await testEnv.DB.prepare(`SELECT id FROM lanyard_assets WHERE event_id = ?`).bind(c.eventId).all<{ id: string }>();
    expect(results.map((r) => r.id).sort()).toEqual([kept, fresh].sort());
  });
});

describe('starter designs', () => {
  it('are valid and ready to print for every size and orientation', async () => {
    const { lanyardDesignSchema, designWarnings } = await import('../src/shared/lanyardDesign');
    for (const [format, orientation] of [['cr80', 'portrait'], ['cr80', 'landscape'], ['large', 'portrait']] as const) {
      const d = starterDesign(format, orientation);
      expect(lanyardDesignSchema.safeParse(d).success, `${format} ${orientation}`).toBe(true);
      expect(designWarnings(d), `${format} ${orientation}`).toEqual([]);
    }
  });
});

describe('design checks', () => {
  it('flag anything covering the QR code, but not things behind it', async () => {
    const { designWarnings } = await import('../src/shared/lanyardDesign');
    const d = starterDesign('cr80', 'portrait');
    const qr = d.front.elements.find((e) => e.type === 'qr')!;
    const logo = { id: 'logo', name: 'Logo', type: 'image' as const, assetId: 'abcdefgh12', x: qr.x + 5, y: qr.y + 5, w: 10, h: 10, fit: 'contain' as const, radius: 0, opacity: 1 };
    const on = { ...d, front: { ...d.front, elements: [...d.front.elements, logo] } };
    expect(designWarnings(on).some((w) => w.level === 'error' && w.elementId === 'logo')).toBe(true);
    const behind = { ...d, front: { ...d.front, elements: [logo, ...d.front.elements] } };
    expect(designWarnings(behind)).toEqual([]);
  });
});
