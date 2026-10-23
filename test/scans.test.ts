import { describe, expect, it } from 'vitest';
import { normaliseShortCode } from '../src/shared/credentials';
import { sha256Hex } from '../src/worker/lib/crypto';
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

interface Camp {
  eventId: string;
  director: Awaited<ReturnType<typeof createUser>>;
  activityId: string;
  otherActivityId: string;
  mealId: string;
  cards: { registrationId: string; token: string; shortCode: string; name: string }[];
}

async function camp(): Promise<Camp> {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, feature_meals = 1, feature_site = 1 WHERE id = ?`).bind(eventId).run();
  const director = await createUser();
  await grant(director.id, 'camp_director', eventId);
  const rows = [
    person('100', { dietaryFingerprint: 'a'.repeat(64), dietary: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }] }),
    person('200', { photoConsent: 'no' }),
    person('300', { kind: 'adult', section: 'Leaders' }),
  ];
  await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows } });
  await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
  const activity = await json(
    await api(`/events/${eventId}/activities`, { cookie: director.cookie, body: { name: 'Kayaking', trackSignOut: true, capacity: 10 } }),
  );
  const other = await json(await api(`/events/${eventId}/activities`, { cookie: director.cookie, body: { name: 'Archery' } }));
  const meal = await json(await api(`/events/${eventId}/meals`, { cookie: director.cookie, body: { name: 'Saturday lunch' } }));
  await api(`/events/${eventId}/transition`, { cookie: director.cookie, body: { to: 'open' } });
  return {
    eventId,
    director,
    activityId: activity.id,
    otherActivityId: other.id,
    mealId: meal.id,
    cards: cards.map((c: any) => ({ registrationId: c.registrationId, token: c.qr.split('#')[1], shortCode: c.shortCode, name: c.name })),
  };
}

async function staff(eventId: string, role: string, activityId: string | null = null) {
  const u = await createUser();
  await grant(u.id, role, eventId, activityId);
  return u;
}

let seq = 0;
async function scanItem(ctx: { contextType: string; contextId: string | null }, token: string, o: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    ...ctx,
    direction: 'in',
    deviceTime: new Date(Date.now() - 60_000 + seq++ * 10).toISOString(),
    method: 'qr',
    credentialHash: await hashToken(token),
    ...o,
  };
}

const upload = (eventId: string, cookie: string, scans: unknown[]) =>
  api(`/events/${eventId}/scans`, { cookie, body: { deviceId: 'test-device-1', scans } });

describe('scan snapshot', () => {
  it('contains hashes and display fields only, never tokens, codes or dietary detail outside meals', async () => {
    const c = await camp();
    const leader = await staff(c.eventId, 'activity_leader', c.activityId);
    const res = await api(`/events/${c.eventId}/scan/activity/${c.activityId}/snapshot`, { cookie: leader.cookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const card of c.cards) {
      expect(text).not.toContain(card.token);
      expect(text).not.toContain(card.shortCode.replace('-', ''));
    }
    const snap = JSON.parse(text);
    expect(snap.people[0]).not.toHaveProperty('dietaryAlert');
    expect(snap.people.find((p: any) => p.memberNumber === '200').noPhotos).toBe(true);
    expect(snap.credentials[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows allergy alerts to meal leaders only', async () => {
    const c = await camp();
    const meal = await staff(c.eventId, 'meal_leader');
    const snap = await json(await api(`/events/${c.eventId}/scan/meal/${c.mealId}/snapshot`, { cookie: meal.cookie }));
    expect(snap.people.find((p: any) => p.memberNumber === '100').dietaryAlert).toBe('Allergy: Peanut (anaphylactic)');
    // Meal leaders are not given photo markers (they don't hold photo.view_status).
    expect(snap.people.find((p: any) => p.memberNumber === '200')).not.toHaveProperty('noPhotos');
    const gate = await staff(c.eventId, 'gate_volunteer');
    expect((await api(`/events/${c.eventId}/scan/meal/${c.mealId}/snapshot`, { cookie: gate.cookie })).status).toBe(403);
  });

  it('confines activity leaders to their own activity', async () => {
    const c = await camp();
    const leader = await staff(c.eventId, 'activity_leader', c.activityId);
    expect((await api(`/events/${c.eventId}/scan/activity/${c.otherActivityId}/snapshot`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/scan/meal/${c.mealId}/snapshot`, { cookie: leader.cookie })).status).toBe(403);
    const { activities } = await json(await api(`/events/${c.eventId}/activities`, { cookie: leader.cookie }));
    expect(activities.map((a: any) => a.id)).toEqual([c.activityId]);
  });

  it('refuses scanning while the event is a draft', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const gate = await staff(eventId, 'gate_volunteer');
    expect((await api(`/events/${eventId}/scan/site/snapshot`, { cookie: gate.cookie })).status).toBe(409);
  });
});

describe('scan upload', () => {
  it('records one meal per person, flags repeats, and is idempotent on retry', async () => {
    const c = await camp();
    const meal = await staff(c.eventId, 'meal_leader');
    const ctx = { contextType: 'meal', contextId: c.mealId };
    const first = await scanItem(ctx, c.cards[0]!.token);
    const second = await scanItem(ctx, c.cards[0]!.token);
    const res = await json(await upload(c.eventId, meal.cookie, [first, second]));
    expect(res.results.map((r: any) => r.outcome)).toEqual(['accepted', 'duplicate']);

    // A network retry of the same batch changes nothing.
    const retry = await json(await upload(c.eventId, meal.cookie, [first, second]));
    expect(retry.results.map((r: any) => r.outcome)).toEqual(['accepted', 'duplicate']);
    const count = await testEnv.DB.prepare(`SELECT count(*) AS n FROM scans WHERE context_id = ?`).bind(c.mealId).first<{ n: number }>();
    expect(count!.n).toBe(2);
  });

  it('two leaders scanning the same person at once count once', async () => {
    const c = await camp();
    const a = await staff(c.eventId, 'meal_leader');
    const b = await staff(c.eventId, 'meal_leader');
    const ctx = { contextType: 'meal', contextId: c.mealId };
    const time = new Date(Date.now() - 1000).toISOString();
    const [ra, rb] = await Promise.all([
      upload(c.eventId, a.cookie, [await scanItem(ctx, c.cards[1]!.token, { deviceTime: time })]).then(json),
      upload(c.eventId, b.cookie, [await scanItem(ctx, c.cards[1]!.token, { deviceTime: time })]).then(json),
    ]);
    const snap = await json(await api(`/events/${c.eventId}/scan/meal/${c.mealId}/snapshot`, { cookie: a.cookie }));
    const served = snap.people.filter((p: any) => p.state?.present).length;
    expect(served).toBe(1);
    expect([ra.results[0].outcome, rb.results[0].outcome]).toContain('accepted');
  });

  it('keeps contexts separate: a meal scan never signs anyone into an activity', async () => {
    const c = await camp();
    const director = c.director;
    await upload(c.eventId, director.cookie, [await scanItem({ contextType: 'meal', contextId: c.mealId }, c.cards[0]!.token)]);
    const snap = await json(await api(`/events/${c.eventId}/scan/activity/${c.activityId}/snapshot`, { cookie: director.cookie }));
    expect(snap.people.every((p: any) => p.state === null)).toBe(true);
  });

  it('rejects unknown, foreign-event and replaced cards', async () => {
    const c = await camp();
    const other = await camp();
    const leader = await staff(c.eventId, 'activity_leader', c.activityId);
    const ctx = { contextType: 'activity', contextId: c.activityId };

    const unknown = await scanItem(ctx, 'x'.repeat(22));
    const foreign = await scanItem(ctx, other.cards[0]!.token);
    const res = await json(await upload(c.eventId, leader.cookie, [unknown, foreign]));
    expect(res.results.map((r: any) => r.outcome)).toEqual(['rejected', 'rejected']);

    await api(`/events/${c.eventId}/credentials/issue`, {
      cookie: c.director.cookie,
      body: { mode: 'replace', registrationIds: [c.cards[2]!.registrationId] },
    });
    // Scanned after the replacement (a scan taken before it, e.g. on an offline phone, still counts).
    const after = new Date(Date.now() + 1000).toISOString();
    const replaced = await json(await upload(c.eventId, leader.cookie, [await scanItem(ctx, c.cards[2]!.token, { deviceTime: after })]));
    expect(replaced.results[0]).toMatchObject({ outcome: 'rejected', message: 'This card has been replaced and no longer works.' });
  });

  it('accepts typed backup codes', async () => {
    const c = await camp();
    const gate = await staff(c.eventId, 'gate_volunteer');
    const code = c.cards[0]!.shortCode.toLowerCase();
    const item = {
      ...(await scanItem({ contextType: 'site', contextId: null }, 'unused')),
      credentialHash: undefined,
      method: 'code',
      codeHash: await sha256Hex(`code:${c.eventId}:${normaliseShortCode(code)}`),
    };
    const res = await json(await upload(c.eventId, gate.cookie, [item]));
    expect(res.results[0]).toMatchObject({ outcome: 'accepted', message: 'Arrived', registrationId: c.cards[0]!.registrationId });
  });

  it('blocks scans into contexts the user may not scan, writing nothing', async () => {
    const c = await camp();
    const leader = await staff(c.eventId, 'activity_leader', c.activityId);
    const res = await upload(c.eventId, leader.cookie, [
      await scanItem({ contextType: 'activity', contextId: c.activityId }, c.cards[0]!.token),
      await scanItem({ contextType: 'activity', contextId: c.otherActivityId }, c.cards[0]!.token),
    ]);
    expect(res.status).toBe(403);
    const count = await testEnv.DB.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>();
    expect(count!.n).toBe(0);

    const elsewhere = await camp();
    expect((await upload(elsewhere.eventId, leader.cookie, [await scanItem({ contextType: 'site', contextId: null }, c.cards[0]!.token)])).status).toBe(404);
  });
});

describe('corrections', () => {
  it('directors can void a scan with a reason; leaders cannot; history is kept', async () => {
    const c = await camp();
    const leader = await staff(c.eventId, 'activity_leader', c.activityId);
    const ctx = { contextType: 'activity', contextId: c.activityId };
    const s = await scanItem(ctx, c.cards[0]!.token);
    await upload(c.eventId, leader.cookie, [s]);

    expect((await api(`/events/${c.eventId}/scans/${s.id}/void`, { cookie: leader.cookie, body: { reason: 'oops' } })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/scans/${s.id}/void`, { cookie: c.director.cookie, body: { reason: 'Scanned wrong child' } })).status).toBe(200);
    expect((await api(`/events/${c.eventId}/scans/${s.id}/void`, { cookie: c.director.cookie, body: { reason: 'again' } })).status).toBe(409);

    const snap = await json(await api(`/events/${c.eventId}/scan/activity/${c.activityId}/snapshot`, { cookie: leader.cookie }));
    expect(snap.people.every((p: any) => !p.state?.present)).toBe(true);
    const rows = await testEnv.DB.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>();
    expect(rows!.n).toBe(2); // original + correction
  });
});

describe('stations', () => {
  it('pairs a shared device to exactly one context with a single-use code', async () => {
    const c = await camp();
    const created = await json(
      await api(`/events/${c.eventId}/stations`, {
        cookie: c.director.cookie,
        body: { name: 'Lunch tablet', contextType: 'meal', contextId: c.mealId, hours: 4 },
      }),
    );
    const pair = await api('/stations/pair', { body: { code: created.pairingCode } });
    expect(pair.status).toBe(200);
    const cookie = pair.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await api('/stations/pair', { body: { code: created.pairingCode } })).status).toBe(400);

    const me = await json(await api('/me', { cookie }));
    expect(me).toMatchObject({ kind: 'station', station: { contextType: 'meal', contextId: c.mealId } });
    expect((await api(`/events/${c.eventId}/scan/meal/${c.mealId}/snapshot`, { cookie })).status).toBe(200);
    expect((await api(`/events/${c.eventId}/registrations`, { cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/scan/site/snapshot`, { cookie })).status).toBe(403);
    const res = await json(await upload(c.eventId, cookie, [await scanItem({ contextType: 'meal', contextId: c.mealId }, c.cards[0]!.token)]));
    expect(res.results[0].outcome).toBe('accepted');

    await api(`/events/${c.eventId}/stations/${created.id}`, { cookie: c.director.cookie, method: 'DELETE' });
    expect((await api('/me', { cookie })).status).toBe(401);
  });

  it('a second meal is out of bounds for a meal station', async () => {
    const c = await camp();
    const dinner = await json(await api(`/events/${c.eventId}/meals`, { cookie: c.director.cookie, body: { name: 'Dinner' } }));
    const created = await json(
      await api(`/events/${c.eventId}/stations`, {
        cookie: c.director.cookie,
        body: { name: 'Lunch', contextType: 'meal', contextId: c.mealId },
      }),
    );
    const cookie = (await api('/stations/pair', { body: { code: created.pairingCode } })).headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await api(`/events/${c.eventId}/scan/meal/${dinner.id}/snapshot`, { cookie })).status).toBe(403);
  });
});
