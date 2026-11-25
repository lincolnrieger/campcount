import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { addPeople, api, createEvent, createUser, grant, json, testEnv } from './helpers';

const row = (participantId: string, overrides: Record<string, unknown> = {}) => ({
  participantId,
  firstName: 'Sam',
  lastName: `Tester${participantId}`,
  kind: 'youth',
  ...overrides,
});

async function setup() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  const director = await createUser();
  await grant(director.id, 'event_manager', eventId);
  return { admin, eventId, director };
}

describe('adding people', () => {
  it('keeps only name, participant ID and role: any other field is refused', async () => {
    const { eventId, director } = await setup();
    for (const extra of [
      { medicare_number: '123' },
      { email: 'a@b.c' },
      { medicalConditions: 'asthma' },
      { groupName: 'Red Gum Club' },
      { level: 'Juniors' },
      { photoConsent: 'yes' },
      { dietary: [] },
      { carRego: 'ABC123' },
    ]) {
      const res = await api(`/events/${eventId}/registrations`, { cookie: director.cookie, body: row('1001', extra) });
      expect(res.status).toBe(400);
    }
    expect((await api(`/events/${eventId}/registrations`, { cookie: director.cookie, body: row('1001') })).status).toBe(201);
  });

  it('has no spreadsheet import', async () => {
    const { eventId, director } = await setup();
    for (const path of ['preview', 'commit', 'context']) {
      const res = await api(`/events/${eventId}/import/${path}`, { cookie: director.cookie, ...(path === 'context' ? {} : { body: { rows: [row('1002')] } }) });
      expect(res.status).toBe(404);
    }
  });

  it('stores names, IDs and lanyard codes encrypted, and shows them decrypted', async () => {
    const { eventId, director } = await setup();
    await addPeople(eventId, director.cookie, [row('7001')]);

    // What the database holds: nothing readable.
    const raw = JSON.stringify([
      (await testEnv.DB.prepare(`SELECT * FROM people p JOIN registrations r ON r.person_id = p.id WHERE r.event_id = ?`).bind(eventId).all()).results,
      (await testEnv.DB.prepare(`SELECT * FROM credentials WHERE event_id = ?`).bind(eventId).all()).results,
    ]);
    for (const plain of ['Sam', 'Tester', '7001']) expect(raw).not.toContain(plain);
    expect(raw).toContain('enc1.');

    // What the app shows: the real values, and nothing more.
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: director.cookie }));
    expect(registrations[0]).toMatchObject({ participantId: '7001', firstName: 'Sam', lastName: 'Tester7001', kind: 'youth', shortCode: '7001' });
    expect(Object.keys(registrations[0]).sort()).toEqual(['displayName', 'firstName', 'id', 'kind', 'lastName', 'participantId', 'shortCode', 'status']);
  });

  it('refuses a participant ID already on the event', async () => {
    const { eventId, director } = await setup();
    await addPeople(eventId, director.cookie, [row('7002')]);
    expect((await addPeople(eventId, director.cookie, [row('7002', { firstName: 'Other' })])).status).toBe(409);
  });
});

describe('roster visibility', () => {
  it('shows no roster to scanners or the meal team', async () => {
    const { eventId, director } = await setup();
    await addPeople(eventId, director.cookie, [row('8001')]);
    for (const role of ['scanner', 'meal_leader']) {
      const volunteer = await createUser();
      await grant(volunteer.id, role, eventId);
      expect((await api(`/events/${eventId}/registrations`, { cookie: volunteer.cookie })).status).toBe(403);
    }
  });

  it('never leaks another event roster', async () => {
    const { admin, director } = await setup();
    const other = await createEvent(admin.id);
    expect((await api(`/events/${other}/registrations`, { cookie: director.cookie })).status).toBe(404);
    expect((await api(`/events/${other}/registrations`, { cookie: director.cookie, body: row('9001') })).status).toBe(404);
  });
});

describe('credentials', () => {
  it('issues one active credential per person, stored hashed, and prints reproducibly', async () => {
    const { eventId, director } = await setup();
    await addPeople(eventId, director.cookie, [row('10001'), row('10002')]);
    // Adding someone issues their lanyard straight away.
    expect(await json(await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } }))).toEqual({ issued: 0 });
    const active = await testEnv.DB.prepare(`SELECT count(*) AS n FROM credentials WHERE event_id = ? AND status = 'active'`).bind(eventId).first<{ n: number }>();
    expect(active!.n).toBe(2);
    expect(await json(await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } }))).toEqual({ issued: 0 });

    const first = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
    const second = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
    expect(first.cards).toHaveLength(2);
    expect(second.cards[0].qr).toBe(first.cards[0].qr);
    expect(first.cards[0].qr).toMatch(/^https:\/\/campcount\.test\/c#[A-Za-z0-9_-]{22}$/);
    // The typed code on the card is the person's participant ID.
    expect(first.cards.map((c: { shortCode: string }) => c.shortCode).sort()).toEqual(['10001', '10002']);

    const token = first.cards[0].qr.split('#')[1];
    const stored = await testEnv.DB.prepare(`SELECT token_hash, token_ciphertext FROM credentials WHERE token_hash = ?`)
      .bind(await hashToken(token))
      .first<{ token_hash: string; token_ciphertext: string }>();
    expect(stored).not.toBeNull();
    expect(stored!.token_ciphertext).not.toContain(token);
  });

  it('replacing a card revokes the old one', async () => {
    const { eventId, director } = await setup();
    await addPeople(eventId, director.cookie, [row('11001')]);
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
    await grant(gate.id, 'scanner', eventId);
    expect((await api(`/events/${eventId}/credentials/print`, { cookie: gate.cookie, body: {} })).status).toBe(403);
    await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} });
    const audit = await testEnv.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE event_id = ? AND action = 'credentials.print'`).bind(eventId).first<{ n: number }>();
    expect(audit!.n).toBe(1);
  });
});
