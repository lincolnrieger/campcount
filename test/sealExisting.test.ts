import { describe, expect, it } from 'vitest';
import { sealExisting } from '../src/worker/services/sealExisting';
import { api, createEvent, createUser, grant, json, keyFor, testEnv } from './helpers';

/** Data written before encryption (migration 0036) is encrypted in place, and still works. */
describe('encrypting existing data', () => {
  it('encrypts plain names, IDs and lanyard codes, once', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { status: 'open' });
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const personId = crypto.randomUUID();
    const regId = crypto.randomUUID();
    const pid = `OLD${Math.floor(Math.random() * 1e6)}`;
    const now = new Date().toISOString();
    // As stored before this release: everything readable.
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO people (id, participant_id, first_name, last_name, created_at, updated_at) VALUES (?, ?, 'Plain', 'Person', ?, ?)`).bind(
        personId,
        pid,
        now,
        now,
      ),
      testEnv.DB.prepare(`INSERT INTO registrations (id, event_id, person_id, kind, created_at, updated_at) VALUES (?, ?, ?, 'adult', ?, ?)`).bind(
        regId,
        eventId,
        personId,
        now,
        now,
      ),
      testEnv.DB.prepare(`INSERT INTO credentials (id, event_id, registration_id, token_hash, token_ciphertext, short_code, issued_at) VALUES (?, ?, ?, ?, 'x', ?, ?)`).bind(
        crypto.randomUUID(),
        eventId,
        regId,
        crypto.randomUUID(),
        pid,
        now,
      ),
    ]);

    const first = await sealExisting(testEnv);
    expect(first.people).toBeGreaterThanOrEqual(1);
    const raw = JSON.stringify([
      await testEnv.DB.prepare(`SELECT * FROM people WHERE id = ?`).bind(personId).first(),
      await testEnv.DB.prepare(`SELECT * FROM registrations WHERE id = ?`).bind(regId).first(),
      (await testEnv.DB.prepare(`SELECT * FROM credentials WHERE registration_id = ?`).bind(regId).all()).results,
    ]);
    for (const plain of ['Plain', 'Person', pid]) expect(raw).not.toContain(plain);
    const row = await testEnv.DB.prepare(`SELECT participant_key FROM people WHERE id = ?`).bind(personId).first<{ participant_key: string }>();
    expect(row!.participant_key).toBe(await keyFor(pid));

    // Running it again changes nothing.
    expect(await sealExisting(testEnv)).toEqual({ people: 0, cards: 0 });

    // The app reads it as before, and finds the person and their lanyard code.
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
    expect(registrations.find((r: { id: string }) => r.id === regId)).toMatchObject({ firstName: 'Plain', lastName: 'Person', participantId: pid, kind: 'adult', shortCode: pid });
    const add = await api(`/events/${eventId}/registrations`, { cookie: manager.cookie, body: { firstName: 'Dup', participantId: pid, kind: 'adult' } });
    expect(add.status).toBe(409);
  });
});
