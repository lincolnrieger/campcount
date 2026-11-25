import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, addPeople } from './helpers';

const person = (participantId: string, kind: 'youth' | 'adult', firstName: string) => ({
  participantId,
  firstName,
  lastName: 'Person',
  kind,
});

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status: 'open' });
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  await addPeople(eventId, manager.cookie, [person('900', 'adult', 'Alex'), person('901', 'adult', 'Bo'), person('100', 'youth', 'Cam')]);
  await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
  const card = (first: string) => {
    const c = cards.find((x: { name: string }) => x.name.startsWith(first));
    return { token: c.qr.split('#')[1] as string, registrationId: c.registrationId as string };
  };
  return { eventId, manager, card };
}

const viewFor = async (token: string) => json(await api('/public/signup/identify', { body: { token } }));

describe('leader roster', () => {
  it('lets the event team roster leaders, and each leader sees their own duties', async () => {
    const c = await camp();
    const alex = c.card('Alex');
    const bo = c.card('Bo');
    const res = await api(`/events/${c.eventId}/duties`, {
      cookie: c.manager.cookie,
      body: {
        title: 'Gate',
        location: 'Main gate',
        notes: 'Bring a radio',
        startsAt: '2026-12-06T08:00:00+10:30',
        endsAt: '2026-12-06T10:00:00+10:30',
        registrationIds: [alex.registrationId],
      },
    });
    expect(res.status).toBe(201);
    const { id } = await json(res);
    expect((await api(`/events/${c.eventId}/duties/${id}/people`, { cookie: c.manager.cookie, body: { registrationId: bo.registrationId } })).status).toBe(200);

    const list = await json(await api(`/events/${c.eventId}/duties`, { cookie: c.manager.cookie }));
    expect(list.duties).toHaveLength(1);
    expect(list.duties[0].people.map((p: { name: string }) => p.name).sort()).toEqual(['Alex Person', 'Bo Person']);
    expect(list.people.filter((p: { leader: boolean }) => p.leader)).toHaveLength(2);

    const view = await viewFor(alex.token);
    expect(view.duties).toEqual([
      { title: 'Gate', location: 'Main gate', notes: 'Bring a radio', startsAt: '2026-12-06T08:00:00+10:30', endsAt: '2026-12-06T10:00:00+10:30', with: 'Bo Person' },
    ]);
    expect((await viewFor(c.card('Cam').token)).duties).toEqual([]);

    // Taking Bo off, then changing the duty.
    await api(`/events/${c.eventId}/duties/${id}/people/${bo.registrationId}`, { cookie: c.manager.cookie, method: 'DELETE' });
    expect((await viewFor(bo.token)).duties).toEqual([]);
    await api(`/events/${c.eventId}/duties/${id}`, { cookie: c.manager.cookie, method: 'PATCH', body: { location: 'Back gate' } });
    expect((await viewFor(alex.token)).duties[0]).toMatchObject({ location: 'Back gate', with: '' });

    await api(`/events/${c.eventId}/duties/${id}`, { cookie: c.manager.cookie, method: 'DELETE' });
    expect((await viewFor(alex.token)).duties).toEqual([]);
  });

  it('checks times, people and permissions', async () => {
    const c = await camp();
    const bad = await api(`/events/${c.eventId}/duties`, {
      cookie: c.manager.cookie,
      body: { title: 'Kitchen', startsAt: '2026-12-06T10:00:00+10:30', endsAt: '2026-12-06T09:00:00+10:30' },
    });
    expect(bad.status).toBe(400);
    const stranger = await api(`/events/${c.eventId}/duties`, {
      cookie: c.manager.cookie,
      body: { title: 'Kitchen', startsAt: '2026-12-06T10:00:00+10:30', registrationIds: [crypto.randomUUID()] },
    });
    expect(stranger.status).toBe(404);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    const denied = await api(`/events/${c.eventId}/duties`, { cookie: scanner.cookie, body: { title: 'Kitchen', startsAt: '2026-12-06T10:00:00+10:30' } });
    expect(denied.status).toBe(403);
  });
});
