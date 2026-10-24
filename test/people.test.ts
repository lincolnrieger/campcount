import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const person = (memberNumber: string, o: Record<string, unknown> = {}) => ({
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
  ...o,
});

/** An open event with three people, two activities (one tracking sign-out), a meal and the gate. */
async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, feature_meals = 1, feature_site = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser({ name: 'Mandy Manager' });
  await grant(manager.id, 'event_manager', eventId);
  await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [person('100'), person('200'), person('300', { kind: 'adult', section: 'Leaders' })] } });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const kayak = await json(await api(`/events/${eventId}/activities`, { cookie: manager.cookie, body: { name: 'Kayaking', trackSignOut: true } }));
  const archery = await json(await api(`/events/${eventId}/activities`, { cookie: manager.cookie, body: { name: 'Archery' } }));
  const meal = await json(await api(`/events/${eventId}/meals`, { cookie: manager.cookie, body: { name: 'Saturday lunch' } }));
  await api(`/events/${eventId}/transition`, { cookie: manager.cookie, body: { to: 'open' } });
  const card = (member: string) => {
    const c = cards.find((x: { name: string }) => x.name.startsWith(`First${member}`));
    return { registrationId: c.registrationId as string, token: c.qr.split('#')[1] as string };
  };
  let seq = 0;
  const scan = async (contextType: string, contextId: string | null, member: string, direction = 'in') =>
    api(`/events/${eventId}/scans`, {
      cookie: manager.cookie,
      body: {
        deviceId: 'test-device',
        scans: [
          {
            id: crypto.randomUUID(),
            contextType,
            contextId,
            direction,
            deviceTime: new Date(Date.now() - 60_000 + seq++ * 1000).toISOString(),
            method: 'qr',
            credentialHash: await hashToken(card(member).token),
          },
        ],
      },
    });
  return { admin, eventId, manager, kayakId: kayak.id as string, archeryId: archery.id as string, mealId: meal.id as string, card, scan };
}

describe('where is everyone', () => {
  it('shows who is on site, off site or not arrived, and who is at each activity', async () => {
    const c = await camp();
    await c.scan('site', null, '100');
    await c.scan('site', null, '200');
    await c.scan('site', null, '200', 'out');
    await c.scan('activity', c.kayakId, '100');
    const res = await json(await api(`/events/${c.eventId}/whereabouts`, { cookie: c.manager.cookie }));
    const by = (m: string) => res.people.find((p: { id: string }) => p.id === c.card(m).registrationId);
    expect(by('100')).toMatchObject({ fullName: 'First100 Person', site: 'on', activities: [{ name: 'Kayaking' }] });
    expect(by('100').lastSeen).toMatchObject({ contextName: 'Kayaking', direction: 'in' });
    expect(by('200')).toMatchObject({ site: 'off', activities: [] });
    expect(by('300')).toMatchObject({ site: 'never', lastSeen: null });
    expect(res.activities.find((a: { name: string }) => a.name === 'Kayaking')).toMatchObject({ presentNow: 1, trackSignOut: true });

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/whereabouts`, { cookie: scanner.cookie })).status).toBe(403);
  });
});

describe('a person on the event', () => {
  it('shows their details, where they are and where they have been', async () => {
    const c = await camp();
    await c.scan('site', null, '100');
    await c.scan('meal', c.mealId, '100');
    await c.scan('meal', c.mealId, '100');
    const id = c.card('100').registrationId;
    const res = await json(await api(`/events/${c.eventId}/registrations/${id}`, { cookie: c.manager.cookie }));
    expect(res.registration).toMatchObject({ firstName: 'First100', memberNumber: '100', photoConsent: 'yes', dietary: [] });
    expect(res.can).toEqual({ edit: true, editDietary: true, cards: true });
    expect(res.where.site).toBe('on');
    expect(res.history.map((h: { place: string; outcome: string }) => [h.place, h.outcome])).toEqual([
      ['Saturday lunch', 'duplicate'],
      ['Saturday lunch', 'accepted'],
      ['Gate', 'accepted'],
    ]);
    expect(res.history[0].by).toBe('Mandy Manager');
  });

  it('lets event managers edit details and dietary needs, and refuses a duplicate membership number', async () => {
    const c = await camp();
    const id = c.card('100').registrationId;
    const path = `/events/${c.eventId}/registrations/${id}`;
    expect((await api(path, { cookie: c.manager.cookie, method: 'PATCH', body: { preferredName: 'Sam', groupName: 'New Troop', photoConsent: 'no' } })).status).toBe(200);
    expect((await api(path, { cookie: c.manager.cookie, method: 'PATCH', body: { memberNumber: '200' } })).status).toBe(409);
    expect(
      (await api(`${path}/dietary`, { cookie: c.manager.cookie, method: 'PUT', body: { entries: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic' }] } })).status,
    ).toBe(200);
    const res = await json(await api(path, { cookie: c.manager.cookie }));
    expect(res.registration).toMatchObject({ preferredName: 'Sam', displayName: 'Sam P.', groupName: 'New Troop', photoConsent: 'no' });
    expect(res.registration.dietary).toEqual([{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }]);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(path, { cookie: scanner.cookie, method: 'PATCH', body: { groupName: 'x' } })).status).toBe(403);
  });

  it('deletes someone with their card and scans, and records it', async () => {
    const c = await camp();
    await c.scan('site', null, '200');
    const id = c.card('200').registrationId;
    const res = await api(`/events/${c.eventId}/registrations/${id}`, { cookie: c.manager.cookie, method: 'DELETE' });
    expect(await json(res)).toEqual({ ok: true, scans: 1 });
    expect(await testEnv.DB.prepare(`SELECT 1 FROM registrations WHERE id = ?`).bind(id).first()).toBeNull();
    expect(await testEnv.DB.prepare(`SELECT 1 FROM scans WHERE registration_id = ?`).bind(id).first()).toBeNull();
    expect(await testEnv.DB.prepare(`SELECT 1 FROM credentials WHERE registration_id = ?`).bind(id).first()).toBeNull();
    const audit = await testEnv.DB.prepare(`SELECT detail FROM audit_log WHERE action = 'registration.delete' AND target_id = ?`).bind(id).first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toEqual({ scans: 1 });
  });
});

describe('deleting activities and meals', () => {
  it('removes the activity or meal with its scans, and stops its stations', async () => {
    const c = await camp();
    await c.scan('activity', c.kayakId, '100');
    await c.scan('meal', c.mealId, '100');
    expect(await json(await api(`/events/${c.eventId}/activities/${c.kayakId}/scan-count`, { cookie: c.manager.cookie }))).toEqual({ scans: 1 });
    const station = await json(await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie, body: { name: 'Lake', contextType: 'activity', contextId: c.kayakId } }));

    expect(await json(await api(`/events/${c.eventId}/activities/${c.kayakId}`, { cookie: c.manager.cookie, method: 'DELETE' }))).toEqual({ ok: true, scans: 1 });
    expect(await json(await api(`/events/${c.eventId}/meals/${c.mealId}`, { cookie: c.manager.cookie, method: 'DELETE' }))).toEqual({ ok: true, scans: 1 });
    expect(await testEnv.DB.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>()).toEqual({ n: 0 });
    const st = await testEnv.DB.prepare(`SELECT revoked_at FROM stations WHERE id = ?`).bind(station.id).first<{ revoked_at: string | null }>();
    expect(st!.revoked_at).not.toBeNull();
    const activities = await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie }));
    expect(activities.activities.map((a: { name: string }) => a.name)).toEqual(['Archery']);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/activities/${c.archeryId}`, { cookie: scanner.cookie, method: 'DELETE' })).status).toBe(403);
  });
});

describe('admin activity log', () => {
  it('lists scans and changes together, newest first, with filters', async () => {
    const c = await camp();
    await c.scan('site', null, '100');
    await api(`/events/${c.eventId}/registrations/${c.card('200').registrationId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { groupName: 'Renamed Troop' } });

    const all = await json(await api(`/admin/log?eventId=${c.eventId}`, { cookie: c.admin.cookie }));
    const scan = all.entries.find((e: { kind: string }) => e.kind === 'scan');
    expect(scan).toMatchObject({ person: 'First100 Person', place: 'Gate', direction: 'in', actor: 'Mandy Manager', outcome: 'accepted' });
    const edit = all.entries.find((e: { action?: string }) => e.action === 'registration.update');
    expect(edit).toMatchObject({ actor: 'Mandy Manager', target: 'First200 Person' });

    const scansOnly = await json(await api(`/admin/log?eventId=${c.eventId}&kind=scans`, { cookie: c.admin.cookie }));
    expect(scansOnly.entries.every((e: { kind: string }) => e.kind === 'scan')).toBe(true);
    const searched = await json(await api(`/admin/log?eventId=${c.eventId}&q=First200`, { cookie: c.admin.cookie }));
    expect(searched.entries.map((e: { kind: string }) => e.kind)).toEqual(['change']);

    expect((await api('/admin/log', { cookie: c.manager.cookie })).status).toBe(403);
  });
});
