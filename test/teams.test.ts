import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const person = (memberNumber: string, photoConsent = 'yes') => ({
  memberNumber,
  firstName: `First${memberNumber}`,
  preferredName: '',
  lastName: 'Person',
  kind: 'youth',
  section: 'Venturers',
  groupName: 'Example Unit',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent,
  dietaryFingerprint: null,
});

async function camp(status = 'open') {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status });
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  await api(`/events/${eventId}/import/commit`, {
    cookie: manager.cookie,
    body: { rows: [person('100'), person('200'), person('300', 'no'), person('400', 'unknown')] },
  });
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const card = (m: string) => {
    const c = cards.find((x: { name: string }) => x.name.startsWith(`First${m}`));
    return { token: c.qr.split('#')[1] as string, registrationId: c.registrationId as string, noPhotos: c.noPhotos as boolean };
  };
  return { admin, eventId, manager, card };
}

const passFor = async (token: string) => (await json(await api('/public/signup/identify', { body: { token } }))).pass as string;

describe('team events', () => {
  it('lets the event team set one up, make teams and fill them up to the limit', async () => {
    const c = await camp();
    const created = await api(`/events/${c.eventId}/team-events`, {
      cookie: c.manager.cookie,
      body: { name: 'Soccer', minSize: 2, maxSize: 2, maxTeams: 2, registrationOpen: false, startsAt: '2026-12-06T14:00:00+10:30' },
    });
    expect(created.status).toBe(201);
    const { id: soccer } = await json(created);

    const team = await json(await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: c.manager.cookie, body: { name: 'Red' } }));
    for (const m of ['100', '200']) {
      expect((await api(`/events/${c.eventId}/teams/${team.id}/members`, { cookie: c.manager.cookie, body: { registrationId: c.card(m).registrationId } })).status).toBe(200);
    }
    // Full at 2.
    const full = await api(`/events/${c.eventId}/teams/${team.id}/members`, { cookie: c.manager.cookie, body: { registrationId: c.card('300').registrationId } });
    expect(full.status).toBe(409);

    const { teamEvents } = await json(await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie }));
    expect(teamEvents[0]).toMatchObject({ name: 'Soccer', minSize: 2, maxSize: 2, maxTeams: 2, registrationOpen: false });
    expect(teamEvents[0].teams[0].members.map((m: { name: string }) => m.name).sort()).toEqual(['First100 P.', 'First200 P.'].sort());

    // Being on a team books them onto the activity, so its scanner knows them.
    const { activities } = await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie }));
    expect(activities.find((a: { id: string }) => a.id === soccer)).toMatchObject({ teamEvent: true, booked: 2, bookingRequired: true });

    // The most teams is enforced, and names are unique.
    expect((await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: c.manager.cookie, body: { name: 'red' } })).status).toBe(409);
    expect((await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: c.manager.cookie, body: { name: 'Blue' } })).status).toBe(201);
    expect((await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: c.manager.cookie, body: { name: 'Green' } })).status).toBe(409);

    // Deleting a team takes its people off the bookings.
    expect((await api(`/events/${c.eventId}/teams/${team.id}`, { cookie: c.manager.cookie, method: 'DELETE' })).status).toBe(200);
    const after = await json(await api(`/events/${c.eventId}/activities`, { cookie: c.manager.cookie }));
    expect(after.activities.find((a: { id: string }) => a.id === soccer).booked).toBe(0);
  });

  it('lets participants make, join and leave teams only while registration is open', async () => {
    const c = await camp();
    const { id: soccer } = await json(
      await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie, body: { name: 'Soccer', minSize: 1, maxSize: 2 } }),
    );
    const a = await passFor(c.card('100').token);
    const closed = await api('/public/signup/team/create', { body: { pass: a, activityId: soccer, name: 'Dolphins' } });
    expect(closed.status).toBe(409);

    await api(`/events/${c.eventId}/team-events/${soccer}`, { cookie: c.manager.cookie, method: 'PATCH', body: { registrationOpen: true } });
    const made = await json(await api('/public/signup/team/create', { body: { pass: a, activityId: soccer, name: 'Dolphins' } }));
    const mine = made.teamEvents.find((t: { id: string }) => t.id === soccer);
    expect(mine.myTeam).toMatchObject({ name: 'Dolphins', members: ['First100 P.'] });
    // Their own team place can't be cancelled as an ordinary booking.
    expect(made.bookings.find((b: { activityId: string }) => b.activityId === soccer).canCancel).toBe(false);
    // One team per person per event.
    expect((await api('/public/signup/team/create', { body: { pass: a, activityId: soccer, name: 'Sharks' } })).status).toBe(409);

    const b = await passFor(c.card('200').token);
    const joined = await json(await api('/public/signup/team/join', { body: { pass: b, teamId: mine.myTeam.id } }));
    expect(joined.teamEvents[0].myTeam.members).toHaveLength(2);
    // Other people only see team names and sizes, never names.
    const d = await json(await api('/public/signup/identify', { body: { token: c.card('300').token } }));
    expect(d.teamEvents[0].teams).toEqual([{ id: mine.myTeam.id, name: 'Dolphins', size: 2, full: true }]);
    expect((await api('/public/signup/team/join', { body: { pass: d.pass, teamId: mine.myTeam.id } })).status).toBe(409);

    // Leaving: the last one out removes the team.
    await api('/public/signup/team/leave', { body: { pass: b, teamId: mine.myTeam.id } });
    const left = await json(await api('/public/signup/team/leave', { body: { pass: a, teamId: mine.myTeam.id } }));
    expect(left.teamEvents[0].teams).toEqual([]);
    const bookings = await testEnv.DB.prepare(`SELECT count(*) AS n FROM activity_bookings WHERE activity_id = ?`).bind(soccer).first<{ n: number }>();
    expect(bookings!.n).toBe(0);
  });

  it("is only for the event team and that event's own leader", async () => {
    const c = await camp();
    const { id: soccer } = await json(await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie, body: { name: 'Soccer' } }));
    const { id: hoops } = await json(await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie, body: { name: 'Basketball' } }));
    const leader = await createUser();
    await grant(leader.id, 'activity_leader', c.eventId, soccer);
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);

    const seen = await json(await api(`/events/${c.eventId}/team-events`, { cookie: leader.cookie }));
    expect(seen.teamEvents.map((t: { id: string }) => t.id)).toEqual([soccer]);
    expect(seen.canManage).toBe(false);
    expect((await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: leader.cookie, body: { name: 'Red' } })).status).toBe(201);
    expect((await api(`/events/${c.eventId}/team-events/${hoops}/teams`, { cookie: leader.cookie, body: { name: 'Red' } })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/team-events/${soccer}`, { cookie: leader.cookie, method: 'PATCH', body: { registrationOpen: true } })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie, body: { name: 'Bad', minSize: 5, maxSize: 3 } })).status).toBe(400);
    expect((await api(`/events/${c.eventId}/team-events`, { cookie: scanner.cookie, body: { name: 'Nope' } })).status).toBe(403);
  });

  it('goes with its activity when deleted', async () => {
    const c = await camp();
    const { id: soccer } = await json(await api(`/events/${c.eventId}/team-events`, { cookie: c.manager.cookie, body: { name: 'Soccer' } }));
    const team = await json(await api(`/events/${c.eventId}/team-events/${soccer}/teams`, { cookie: c.manager.cookie, body: { name: 'Red' } }));
    await api(`/events/${c.eventId}/teams/${team.id}/members`, { cookie: c.manager.cookie, body: { registrationId: c.card('100').registrationId } });
    expect((await api(`/events/${c.eventId}/activities/${soccer}`, { cookie: c.manager.cookie, method: 'DELETE' })).status).toBe(200);
    const left = await testEnv.DB.prepare(`SELECT (SELECT count(*) FROM teams WHERE activity_id = ?1) + (SELECT count(*) FROM team_members WHERE activity_id = ?1) AS n`)
      .bind(soccer)
      .first<{ n: number }>();
    expect(left!.n).toBe(0);
  });
});

describe('lanyards', () => {
  it('marks cards for anyone without photo consent, in the style the event chose', async () => {
    const c = await camp();
    expect(c.card('100').noPhotos).toBe(false);
    expect(c.card('300').noPhotos).toBe(true);
    expect(c.card('400').noPhotos).toBe(true);

    const { event } = await json(await api(`/events/${c.eventId}`, { cookie: c.manager.cookie }));
    expect(event.lanyard).toEqual({ photoMarker: 'black_border', photoMarkerColour: '#B3261E', photoMarkerLabel: true, printBand: true });
    const saved = await json(
      await api(`/events/${c.eventId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { lanyard: { photoMarker: 'red_dot', photoMarkerLabel: false } } }),
    );
    expect(saved.event.lanyard).toMatchObject({ photoMarker: 'red_dot', photoMarkerLabel: false });
    expect((await api(`/events/${c.eventId}`, { cookie: c.manager.cookie, method: 'PATCH', body: { lanyard: { photoMarker: 'glitter' } } })).status).toBe(400);
  });
});

describe('deleting stations', () => {
  it('removes a finished station from the list but keeps its scans', async () => {
    const c = await camp();
    const created = await json(
      await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie, body: { name: 'Gate tablet', contextType: 'site', contextId: null, hours: 4 } }),
    );
    const pair = await api('/stations/pair', { body: { code: created.pairingCode } });
    const cookie = pair.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await api(`/events/${c.eventId}/stations/${created.id}/remove`, { cookie: c.manager.cookie, body: {} })).status).toBe(200);
    // Signed out, gone from the list, and can't be reopened or deleted twice.
    expect((await api('/me', { cookie })).status).toBe(401);
    const { stations } = await json(await api(`/events/${c.eventId}/stations`, { cookie: c.manager.cookie }));
    expect(stations).toEqual([]);
    expect((await api(`/events/${c.eventId}/stations/${created.id}/reopen`, { cookie: c.manager.cookie, body: {} })).status).toBe(404);
    expect((await api(`/events/${c.eventId}/stations/${created.id}/remove`, { cookie: c.manager.cookie, body: {} })).status).toBe(404);
    const row = await testEnv.DB.prepare(`SELECT deleted_at FROM stations WHERE id = ?`).bind(created.id).first<{ deleted_at: string | null }>();
    expect(row!.deleted_at).not.toBeNull();
  });
});
