import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const row = (memberNumber: string, overrides: Record<string, unknown> = {}) => ({
  memberNumber,
  firstName: 'Sam',
  preferredName: '',
  lastName: `Tester${memberNumber}`,
  kind: 'youth',
  section: 'Cubs',
  groupName: 'Example Cub Unit',
  position: '',
  roleLabel: 'Participant',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
  ...overrides,
});
const FP = (n: number) => n.toString(16).padStart(64, '0');

async function setup(features: { dietary?: boolean } = { dietary: true }) {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = ? WHERE id = ?`).bind(features.dietary ? 1 : 0, eventId).run();
  const director = await createUser();
  await grant(director.id, 'camp_director', eventId);
  return { admin, eventId, director };
}

describe('roster import', () => {
  it('rejects any field outside the allowlist', async () => {
    const { eventId, director } = await setup();
    for (const extra of [{ medicare_number: '123' }, { email: 'a@b.c' }, { medicalConditions: 'asthma' }]) {
      const res = await api(`/events/${eventId}/import/preview`, {
        cookie: director.cookie,
        body: { rows: [row('1001', extra)] },
      });
      expect(res.status).toBe(400);
    }
  });

  it('previews without writing, then commits exactly what was previewed', async () => {
    const { eventId, director } = await setup();
    const rows = [row('1001'), row('1002', { kind: 'adult', section: 'Leaders' })];
    const preview = await json(await api(`/events/${eventId}/import/preview`, { cookie: director.cookie, body: { rows } }));
    expect(preview.plan.counts).toMatchObject({ create: 2, update: 0, unchanged: 0 });
    const before = await testEnv.DB.prepare(`SELECT count(*) AS n FROM registrations WHERE event_id = ?`).bind(eventId).first<{ n: number }>();
    expect(before!.n).toBe(0);

    const commit = await json(await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows } }));
    expect(commit.counts).toMatchObject({ create: 2 });
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: director.cookie }));
    expect(registrations).toHaveLength(2);
    expect(registrations[0].displayName).toMatch(/^Sam T\.$/);
  });

  it('is idempotent and reports changes on re-import', async () => {
    const { eventId, director } = await setup();
    const rows = [row('2001'), row('2002')];
    await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows } });
    const again = await json(await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows } }));
    expect(again.counts).toMatchObject({ create: 0, update: 0, unchanged: 2 });

    const changed = [row('2001', { photoConsent: 'no' }), row('2002')];
    const preview = await json(await api(`/events/${eventId}/import/preview`, { cookie: director.cookie, body: { rows: changed } }));
    expect(preview.plan.rows[0]).toMatchObject({ action: 'update', changes: ['Photo consent'] });
    const people = await testEnv.DB.prepare(`SELECT count(*) AS n FROM people WHERE member_number IN ('2001','2002')`).first<{ n: number }>();
    expect(people!.n).toBe(2);
  });

  it('withdraws people missing from the new file only when asked, and never deletes them', async () => {
    const { eventId, director } = await setup();
    await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [row('3001'), row('3002')] } });
    const keep = await json(await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [row('3001')] } }));
    expect(keep.counts.withdraw).toBe(0);
    const res = await json(
      await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [row('3001')], withdrawMissing: true } }),
    );
    expect(res.counts.withdraw).toBe(1);
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: director.cookie }));
    expect(registrations.find((r: any) => r.memberNumber === '3002').status).toBe('withdrawn');
  });

  it('rejects files with duplicate membership numbers', async () => {
    const { eventId, director } = await setup();
    const res = await api(`/events/${eventId}/import/preview`, { cookie: director.cookie, body: { rows: [row('4001'), row('4001')] } });
    expect(res.status).toBe(400);
    expect((await json(res)).error.message).toContain('4001');
  });

  it('stores reviewed dietary entries and flags unreviewed dietary changes', async () => {
    const { eventId, director } = await setup();
    const reviewed = row('5001', {
      dietaryFingerprint: FP(1),
      dietary: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }],
    });
    const unreviewed = row('5002', { dietaryFingerprint: FP(2) });
    const res = await json(await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [reviewed, unreviewed] } }));
    expect(res.counts.dietaryPending).toBe(1);

    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: director.cookie }));
    const a = registrations.find((r: any) => r.memberNumber === '5001');
    expect(a.dietary).toEqual([{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }]);
    expect(a.dietaryFingerprint).toBe(FP(1));
    const b = registrations.find((r: any) => r.memberNumber === '5002');
    expect(b.dietaryFingerprint).toBeNull(); // still awaiting review

    // Same text next time: nothing to review for 5001; 5002 is still pending.
    const preview = await json(
      await api(`/events/${eventId}/import/preview`, { cookie: director.cookie, body: { rows: [row('5001', { dietaryFingerprint: FP(1) }), unreviewed] } }),
    );
    expect(preview.plan.rows.map((r: any) => r.dietaryPending)).toEqual([false, true]);
  });

  it('only people with dietary.edit can submit dietary entries', async () => {
    const { eventId } = await setup();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const withDietary = row('6001', { dietaryFingerprint: FP(3), dietary: [] });
    expect((await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [withDietary] } })).status).toBe(403);
    // But they can import the roster; dietary stays pending for the director.
    const ok = await json(await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('6001', { dietaryFingerprint: FP(3) })] } }));
    expect(ok.counts.dietaryPending).toBe(1);
  });

  it('rejects dietary data when the feature is off', async () => {
    const { eventId, director } = await setup({ dietary: false });
    const res = await api(`/events/${eventId}/import/commit`, {
      cookie: director.cookie,
      body: { rows: [row('7001', { dietaryFingerprint: FP(4), dietary: [] })] },
    });
    expect(res.status).toBe(400);
  });
});

describe('roster visibility', () => {
  it('hides dietary detail from event managers and the roster from volunteers', async () => {
    const { eventId, director } = await setup();
    await api(`/events/${eventId}/import/commit`, {
      cookie: director.cookie,
      body: { rows: [row('8001', { dietaryFingerprint: FP(5), dietary: [{ category: 'preference', item: 'Vegetarian', severity: 'standard', note: '' }] })] },
    });
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
    expect(registrations[0]).not.toHaveProperty('dietary');
    expect(registrations[0]).toHaveProperty('photoConsent');

    for (const role of ['activity_leader', 'gate_volunteer', 'meal_leader']) {
      const volunteer = await createUser();
      await grant(volunteer.id, role, eventId);
      expect((await api(`/events/${eventId}/registrations`, { cookie: volunteer.cookie })).status).toBe(403);
    }
  });

  it('never leaks another event roster', async () => {
    const { admin, director } = await setup();
    const other = await createEvent(admin.id);
    expect((await api(`/events/${other}/registrations`, { cookie: director.cookie })).status).toBe(404);
    expect((await api(`/events/${other}/import/preview`, { cookie: director.cookie, body: { rows: [row('9001')] } })).status).toBe(404);
  });
});

describe('credentials', () => {
  it('issues one active credential per person, stored hashed, and prints reproducibly', async () => {
    const { eventId, director } = await setup();
    await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [row('10001'), row('10002')] } });
    expect(await json(await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } }))).toEqual({ issued: 2 });
    expect(await json(await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } }))).toEqual({ issued: 0 });

    const first = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
    const second = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
    expect(first.cards).toHaveLength(2);
    expect(second.cards[0].qr).toBe(first.cards[0].qr);
    expect(first.cards[0].qr).toMatch(/^https:\/\/campcount\.test\/c#[A-Za-z0-9_-]{22}$/);
    expect(first.cards[0].shortCode).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const token = first.cards[0].qr.split('#')[1];
    const stored = await testEnv.DB.prepare(`SELECT token_hash, token_ciphertext FROM credentials WHERE token_hash = ?`)
      .bind(await hashToken(token))
      .first<{ token_hash: string; token_ciphertext: string }>();
    expect(stored).not.toBeNull();
    expect(stored!.token_ciphertext).not.toContain(token);
  });

  it('replacing a card revokes the old one', async () => {
    const { eventId, director } = await setup();
    await api(`/events/${eventId}/import/commit`, { cookie: director.cookie, body: { rows: [row('11001')] } });
    await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } });
    const before = (await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }))).cards[0];
    await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'replace', registrationIds: [before.registrationId] } });
    const after = (await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }))).cards[0];
    expect(after.qr).not.toBe(before.qr);
    const old = await testEnv.DB.prepare(`SELECT status FROM credentials WHERE token_hash = ?`)
      .bind(await hashToken(before.qr.split('#')[1]))
      .first<{ status: string }>();
    expect(old!.status).toBe('revoked');
  });

  it('printing is restricted and audited', async () => {
    const { eventId, director } = await setup();
    const gate = await createUser();
    await grant(gate.id, 'gate_volunteer', eventId);
    expect((await api(`/events/${eventId}/credentials/print`, { cookie: gate.cookie, body: {} })).status).toBe(403);
    await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} });
    const audit = await testEnv.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE event_id = ? AND action = 'credentials.print'`)
      .bind(eventId)
      .first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });
});
