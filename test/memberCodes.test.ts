import { describe, expect, it } from 'vitest';
import { codeHash } from '../src/worker/routes/scans';
import { api, createEvent, createUser, grant, json, testEnv, addPeople } from './helpers';

const row = (participantId: string, firstName: string) => ({
  participantId,
  firstName,
  lastName: 'Code',
  kind: 'youth',
});

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_self_signup = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const n = String(3000000 + Math.floor(Math.random() * 999999));
  await addPeople(eventId, manager.cookie, [row(n, 'Mem')]);
  await api(`/events/${eventId}/registrations`, {
    cookie: manager.cookie,
    body: { firstName: 'Gus', lastName: 'Guest', participantId: null, kind: 'adult' },
  });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const print = async () =>
    (await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }))).cards as { registrationId: string; name: string; shortCode: string }[];
  const code = (await json(await api(`/events/${eventId}/signup`, { cookie: manager.cookie }))).link.split('/signup/')[1] as string;
  return { eventId, manager, n, print, code };
}

describe('lanyard code is the participant ID', () => {
  it('prints the participant ID as the typed code; guests get a random code', async () => {
    const c = await camp();
    const cards = await c.print();
    expect(cards.find((x) => x.name.startsWith('Mem'))!.shortCode).toBe(c.n);
    expect(cards.find((x) => x.name.startsWith('Gus'))!.shortCode).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  });

  it('works when typed at the kiosk and on the scanner, and survives replacing a lost lanyard', async () => {
    const c = await camp();
    const mem = (await c.print()).find((x) => x.name.startsWith('Mem'))!;
    // Kiosk: type the participant ID.
    expect((await api('/public/signup/identify', { body: { shortCode: c.n, code: c.code } })).status).toBe(200);
    // Replace the lanyard: the new card carries the same number; the old card's code is retired.
    await api(`/events/${c.eventId}/credentials/issue`, { cookie: c.manager.cookie, body: { mode: 'replace', registrationIds: [mem.registrationId] } });
    const again = (await c.print()).find((x) => x.name.startsWith('Mem'))!;
    expect(again.shortCode).toBe(c.n);
    const old = await testEnv.DB.prepare(`SELECT short_code FROM credentials WHERE registration_id = ? AND status = 'revoked'`)
      .bind(mem.registrationId)
      .first<{ short_code: string }>();
    expect(old!.short_code).not.toBe(c.n);
    // Scanner: a typed participant ID finds them.
    await api(`/events/${c.eventId}/transition`, { cookie: c.manager.cookie, body: { to: 'open' } });
    const res = await json(
      await api(`/events/${c.eventId}/scans`, {
        cookie: c.manager.cookie,
        body: {
          deviceId: 'test-device',
          scans: [
            {
              id: crypto.randomUUID(),
              contextType: 'site',
              contextId: null,
              direction: 'in',
              deviceTime: new Date().toISOString(),
              method: 'code',
              codeHash: await codeHash(c.eventId, c.n),
            },
          ],
        },
      }),
    );
    expect(res.results[0]).toMatchObject({ outcome: 'accepted', registrationId: mem.registrationId });
  });

  it('follows a corrected participant ID', async () => {
    const c = await camp();
    const mem = (await c.print()).find((x) => x.name.startsWith('Mem'))!;
    const fixed = String(Number(c.n) + 1);
    expect((await api(`/events/${c.eventId}/registrations/${mem.registrationId}`, { method: 'PATCH', cookie: c.manager.cookie, body: { participantId: fixed } })).status).toBe(200);
    expect((await c.print()).find((x) => x.name.startsWith('Mem'))!.shortCode).toBe(fixed);
  });
});
