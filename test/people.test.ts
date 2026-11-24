import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { api, createEvent, createUser, grant, json, testEnv, keyFor, vaultDb } from './helpers';

const person = (participantId: string, o: Record<string, unknown> = {}) => ({
  participantId,
  firstName: `First${participantId}`,
  lastName: 'Person',
  kind: 'youth',
  level: 'Seniors',
  groupName: 'Example Club',
  photoConsent: 'yes',
  ...o,
});

/** An open event with three people, two activities (one tracking sign-out), a meal and the gate. */
async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, feature_meals = 1, feature_site = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser({ name: 'Mandy Manager' });
  await grant(manager.id, 'event_manager', eventId);
  await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [person('100'), person('200'), person('300', { kind: 'adult', level: 'Leaders' })] } });
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
    expect(res.registration).toMatchObject({ firstName: 'First100', participantId: '100', photoConsent: 'yes', dietary: [] });
    expect(res.can).toEqual({ edit: true, editDietary: true, cards: true });
    expect(res.where.site).toBe('on');
    expect(res.history.map((h: { place: string; outcome: string }) => [h.place, h.outcome])).toEqual([
      ['Saturday lunch', 'duplicate'],
      ['Saturday lunch', 'accepted'],
      ['Gate', 'accepted'],
    ]);
    expect(res.history[0].by).toBe('Mandy Manager');
  });

  it('lets event managers edit details and dietary needs, and refuses a duplicate participant ID', async () => {
    const c = await camp();
    // Someone only on this camp (people on other camps too can't be renamed from here; see crossCamp.test.ts).
    const own = String(500000 + Math.floor(Math.random() * 499999));
    await api(`/events/${c.eventId}/import/commit`, { cookie: c.manager.cookie, body: { rows: [person(own)], withdrawMissing: false } });
    const id = (await vaultDb().prepare(
      `SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.participant_key = ?`,
    )
      .bind(c.eventId, await keyFor(own))
      .first<{ id: string }>())!.id;
    const path = `/events/${c.eventId}/registrations/${id}`;
    expect((await api(path, { cookie: c.manager.cookie, method: 'PATCH', body: { groupName: 'New Club', photoConsent: 'no' } })).status).toBe(200);
    expect((await api(path, { cookie: c.manager.cookie, method: 'PATCH', body: { participantId: '200' } })).status).toBe(409);
    expect(
      (await api(`${path}/dietary`, { cookie: c.manager.cookie, method: 'PUT', body: { entries: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic' }] } })).status,
    ).toBe(200);
    const res = await json(await api(path, { cookie: c.manager.cookie }));
    expect(res.registration).toMatchObject({ displayName: `First${own} P.`, groupName: 'New Club', photoConsent: 'no' });
    expect(res.registration.dietary).toEqual([{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }]);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(path, { cookie: scanner.cookie, method: 'PATCH', body: { groupName: 'x' } })).status).toBe(403);
  });

  it('records when each lanyard was issued and printed', async () => {
    const c = await camp();
    const print = async () => (await json(await api(`/events/${c.eventId}/credentials/print`, { cookie: c.manager.cookie, body: {} }))).cards as { registrationId: string; issuedAt: string; printedAt: string | null }[];
    const first = await print();
    expect(first.every((x) => x.issuedAt && x.printedAt === null)).toBe(true);
    const id = c.card('100').registrationId;
    const mark = (printed: boolean) => api(`/events/${c.eventId}/credentials/printed`, { cookie: c.manager.cookie, body: { registrationIds: [id], printed } });
    expect((await mark(true)).status).toBe(200);
    const after = await print();
    expect(after.find((x) => x.registrationId === id)!.printedAt).toMatch(/^20/);
    expect(after.filter((x) => x.registrationId !== id).every((x) => x.printedAt === null)).toBe(true);
    await mark(false);
    expect((await print()).find((x) => x.registrationId === id)!.printedAt).toBeNull();
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/credentials/printed`, { cookie: scanner.cookie, body: { registrationIds: [id], printed: true } })).status).toBe(403);
  });

  it('marks dietary needs as reviewed (a yes or no only) when saved', async () => {
    const c = await camp();
    const id = c.card('100').registrationId;
    const reviewedOf = async () =>
      (await json(await api(`/events/${c.eventId}/registrations`, { cookie: c.manager.cookie }))).registrations.find((r: { id: string }) => r.id === id).dietaryReviewed;
    expect(await reviewedOf()).toBe(false);
    const put = (body: object) => api(`/events/${c.eventId}/registrations/${id}/dietary`, { cookie: c.manager.cookie, method: 'PUT', body });
    expect((await put({ entries: [] })).status).toBe(200);
    expect(await reviewedOf()).toBe(true);
    // Nothing about notes is accepted.
    expect((await put({ entries: [], checkedNotes: ['abc123'] })).status).toBe(400);
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
    await api(`/events/${c.eventId}/registrations/${c.card('200').registrationId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { groupName: 'Renamed Club' } });

    const all = await json(await api(`/admin/log?eventId=${c.eventId}`, { cookie: c.admin.cookie }));
    const scan = all.entries.find((e: { kind: string }) => e.kind === 'scan');
    expect(scan).toMatchObject({ person: 'First100 Person', place: 'Gate', direction: 'in', actor: 'Mandy Manager', outcome: 'accepted' });
    const edit = all.entries.find((e: { action?: string }) => e.action === 'registration.update');
    expect(edit).toMatchObject({ actor: 'Mandy Manager', target: 'First200 Person' });

    const scansOnly = await json(await api(`/admin/log?eventId=${c.eventId}&kind=scans`, { cookie: c.admin.cookie }));
    expect(scansOnly.entries.every((e: { kind: string }) => e.kind === 'scan')).toBe(true);
    // Participant names are encrypted, so the search finds places, staff and actions, not participants.
    const searched = await json(await api(`/admin/log?eventId=${c.eventId}&q=registration.update`, { cookie: c.admin.cookie }));
    expect(searched.entries.map((e: { kind: string }) => e.kind)).toEqual(['change']);
    expect((await json(await api(`/admin/log?eventId=${c.eventId}&q=First200`, { cookie: c.admin.cookie }))).entries).toEqual([]);

    expect((await api('/admin/log', { cookie: c.manager.cookie })).status).toBe(403);
  });
});

describe('activity and meal times', () => {
  it('keeps times and settings when an activity or meal is only cancelled', async () => {
    const c = await camp();
    const body = { name: 'Kayaking session 2', location: 'Lake', capacity: 12, trackSignOut: true, startsAt: '2026-12-05T11:00:00+10:30', endsAt: '2026-12-05T12:30:00+10:30' };
    const { id } = await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie, body }));
    await api(`/events/${c.eventId}/activities/${id}`, { cookie: c.manager.cookie, method: 'PATCH', body: { status: 'cancelled' } });
    const a = (await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie }))).activities.find((x: { id: string }) => x.id === id);
    expect(a).toMatchObject({ status: 'cancelled', location: 'Lake', capacity: 12, trackSignOut: true, startsAt: body.startsAt, endsAt: body.endsAt });

    await api(`/events/${c.eventId}/meals/${c.mealId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { startsAt: '2026-12-05T12:30:00+10:30' } });
    await api(`/events/${c.eventId}/meals/${c.mealId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { status: 'cancelled' } });
    const m = (await json(await api(`/events/${c.eventId}/meals`, { cookie: c.manager.cookie }))).meals.find((x: { id: string }) => x.id === c.mealId);
    expect(m).toMatchObject({ status: 'cancelled', startsAt: '2026-12-05T12:30:00+10:30' });
  });
});

describe('adding someone by hand', () => {
  it('puts them on the roster with a card, and refuses a duplicate participant ID', async () => {
    const c = await camp();
    const body = { firstName: 'Hana', lastName: 'Cook', participantId: null, kind: 'adult', level: 'Leaders', photoConsent: 'yes', dietary: [] };
    const res = await api(`/events/${c.eventId}/registrations`, { cookie: c.manager.cookie, body });
    expect(res.status).toBe(201);
    const { registrationId } = await json(res);
    const person = (await json(await api(`/events/${c.eventId}/registrations/${registrationId}`, { cookie: c.manager.cookie }))).registration;
    expect(person).toMatchObject({ kind: 'adult', firstName: 'Hana', lastName: 'Cook' });
    expect(person).not.toHaveProperty('position');
    expect(person.participantId).toMatch(/^GUEST-/);
    expect(person.shortCode).not.toBeNull();
    expect((await api(`/events/${c.eventId}/registrations`, { cookie: c.manager.cookie, body: { ...body, participantId: '100' } })).status).toBe(409);
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/registrations`, { cookie: scanner.cookie, body })).status).toBe(403);
  });
});
