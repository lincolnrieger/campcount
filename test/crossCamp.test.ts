import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, keyFor, vaultDb } from './helpers';

/** A person record is shared by every camp they go to; one camp mustn't be able to rename them on another. */

const row = (participantId: string, firstName: string) => ({
  participantId,
  firstName,
  lastName: 'Person',
  kind: 'youth',
  level: 'Seniors',
  groupName: 'Example Club',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

const nameOf = async (participantId: string) =>
  (await vaultDb().prepare(`SELECT first_name FROM people WHERE participant_key = ?`).bind(await keyFor(participantId)).first<{ first_name: string }>())
    ?.first_name;

async function twoCamps() {
  const admin = await createUser({ platformAdmin: true });
  const campA = await createEvent(admin.id, { name: 'Camp A' });
  const campB = await createEvent(admin.id, { name: 'Camp B' });
  const managerA = await createUser();
  await grant(managerA.id, 'event_manager', campA);
  const managerB = await createUser();
  await grant(managerB.id, 'event_manager', campB);
  const participantId = String(100000 + Math.floor(Math.random() * 899999));
  const seeded = await api(`/events/${campB}/import/commit`, { cookie: managerB.cookie, body: { rows: [row(participantId, "Real")] } });
  if (seeded.status !== 200) throw new Error(await seeded.text());
  return { admin, campA, campB, managerA, managerB, participantId };
}

describe("one camp can't rename a child on another camp", () => {
  it('by importing their participant ID with a different name', async () => {
    const t = await twoCamps();
    const res = await api(`/events/${t.campA}/import/commit`, { cookie: t.managerA.cookie, body: { rows: [row(t.participantId, 'Changed')] } });
    expect(res.status).toBe(200);
    expect(await nameOf(t.participantId)).toBe('Real');
  });

  it('by adding them by hand with a different name', async () => {
    const t = await twoCamps();
    const res = await api(`/events/${t.campA}/registrations`, {
      cookie: t.managerA.cookie,
      body: { firstName: 'Changed', lastName: 'Person', participantId: t.participantId, kind: 'youth', level: 'Seniors', photoConsent: 'yes' },
    });
    expect(res.status).toBeLessThan(300);
    expect(await nameOf(t.participantId)).toBe('Real');
  });

  it('by editing them, though someone who runs both camps can', async () => {
    const t = await twoCamps();
    await api(`/events/${t.campA}/import/commit`, { cookie: t.managerA.cookie, body: { rows: [row(t.participantId, 'Real')] } });
    const reg = await vaultDb().prepare(
      `SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.participant_key = ?`,
    )
      .bind(t.campA, await keyFor(t.participantId))
      .first<{ id: string }>();
    const edit = (cookie: string) =>
      api(`/events/${t.campA}/registrations/${reg!.id}`, { method: 'PATCH', cookie, body: { firstName: 'Changed' } });
    const refused = await edit(t.managerA.cookie);
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.message).toMatch(/also on another camp/);
    // Group and level are per camp, so those can still be edited.
    expect((await api(`/events/${t.campA}/registrations/${reg!.id}`, { method: 'PATCH', cookie: t.managerA.cookie, body: { groupName: 'New Club' } })).status).toBe(200);
    // Someone who runs both camps can fix the name.
    await grant(t.managerA.id, 'event_manager', t.campB);
    expect((await edit(t.managerA.cookie)).status).toBe(200);
    expect(await nameOf(t.participantId)).toBe('Changed');
  });

  it('still updates names from an import when the person is only on this camp', async () => {
    const t = await twoCamps();
    await api(`/events/${t.campB}/import/commit`, { cookie: t.managerB.cookie, body: { rows: [row(t.participantId, 'Renamed')] } });
    expect(await nameOf(t.participantId)).toBe('Renamed');
  });
});
