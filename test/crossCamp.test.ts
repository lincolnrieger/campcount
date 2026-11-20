import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

/** A person record is shared by every camp they go to; one camp mustn't be able to rename them on another. */

const row = (memberNumber: string, firstName: string) => ({
  memberNumber,
  firstName,
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
});

const nameOf = async (memberNumber: string) =>
  (await testEnv.DB.prepare(`SELECT first_name FROM people WHERE member_number = ?`).bind(memberNumber).first<{ first_name: string }>())
    ?.first_name;

async function twoCamps() {
  const admin = await createUser({ platformAdmin: true });
  const campA = await createEvent(admin.id, { name: 'Camp A' });
  const campB = await createEvent(admin.id, { name: 'Camp B' });
  const managerA = await createUser();
  await grant(managerA.id, 'event_manager', campA);
  const managerB = await createUser();
  await grant(managerB.id, 'event_manager', campB);
  const memberNumber = String(100000 + Math.floor(Math.random() * 899999));
  const seeded = await api(`/events/${campB}/import/commit`, { cookie: managerB.cookie, body: { rows: [row(memberNumber, "Real")] } });
  if (seeded.status !== 200) throw new Error(await seeded.text());
  return { admin, campA, campB, managerA, managerB, memberNumber };
}

describe("one camp can't rename a child on another camp", () => {
  it('by importing their membership number with a different name', async () => {
    const t = await twoCamps();
    const res = await api(`/events/${t.campA}/import/commit`, { cookie: t.managerA.cookie, body: { rows: [row(t.memberNumber, 'Changed')] } });
    expect(res.status).toBe(200);
    expect(await nameOf(t.memberNumber)).toBe('Real');
  });

  it('by adding them by hand with a different name', async () => {
    const t = await twoCamps();
    const res = await api(`/events/${t.campA}/registrations`, {
      cookie: t.managerA.cookie,
      body: { firstName: 'Changed', lastName: 'Person', memberNumber: t.memberNumber, kind: 'youth', section: 'Scouts', photoConsent: 'yes' },
    });
    expect(res.status).toBeLessThan(300);
    expect(await nameOf(t.memberNumber)).toBe('Real');
  });

  it('by editing them, though someone who runs both camps can', async () => {
    const t = await twoCamps();
    await api(`/events/${t.campA}/import/commit`, { cookie: t.managerA.cookie, body: { rows: [row(t.memberNumber, 'Real')] } });
    const reg = await testEnv.DB.prepare(
      `SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ?`,
    )
      .bind(t.campA, t.memberNumber)
      .first<{ id: string }>();
    const edit = (cookie: string) =>
      api(`/events/${t.campA}/registrations/${reg!.id}`, { method: 'PATCH', cookie, body: { firstName: 'Changed' } });
    const refused = await edit(t.managerA.cookie);
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.message).toMatch(/also on another camp/);
    // Group and section are per camp, so those can still be edited.
    expect((await api(`/events/${t.campA}/registrations/${reg!.id}`, { method: 'PATCH', cookie: t.managerA.cookie, body: { groupName: 'New Troop' } })).status).toBe(200);
    // Someone who runs both camps can fix the name.
    await grant(t.managerA.id, 'event_manager', t.campB);
    expect((await edit(t.managerA.cookie)).status).toBe(200);
    expect(await nameOf(t.memberNumber)).toBe('Changed');
  });

  it('still updates names from an import when the person is only on this camp', async () => {
    const t = await twoCamps();
    await api(`/events/${t.campB}/import/commit`, { cookie: t.managerB.cookie, body: { rows: [row(t.memberNumber, 'Renamed')] } });
    expect(await nameOf(t.memberNumber)).toBe('Renamed');
  });
});
