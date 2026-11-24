import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json } from './helpers';

const row = (participantId: string, kind: 'youth' | 'adult') => ({
  participantId,
  firstName: `P${participantId}`,
  lastName: 'Example',
  kind,
  level: kind === 'adult' ? 'Leaders' : 'Seniors',
  groupName: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

describe('car rego', () => {
  it('asks leaders once at the scanner, and keeps participant ID from scanners who can’t see the roster', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { status: 'open' });
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('1', 'adult'), row('2', 'youth')] } });
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', eventId);

    const snap = async (cookie: string) => (await json(await api(`/events/${eventId}/scan/site/snapshot`, { cookie }))).people as { id: string; kind: string; askRego?: boolean; participantId?: string }[];
    let people = await snap(scanner.cookie);
    const leader = people.find((p) => p.kind === 'adult')!;
    expect(leader.askRego).toBe(true);
    expect(people.find((p) => p.kind === 'youth')!.askRego).toBeUndefined();
    expect(people.every((p) => p.participantId === undefined)).toBe(true);
    expect((await snap(manager.cookie)).every((p) => typeof p.participantId === 'string')).toBe(true);

    expect((await api(`/events/${eventId}/registrations/${leader.id}/rego`, { cookie: scanner.cookie, body: { rego: 's123abc' } })).status).toBe(200);
    people = await snap(scanner.cookie);
    expect(people.find((p) => p.id === leader.id)!.askRego).toBeUndefined();
    const detail = await json(await api(`/events/${eventId}/registrations/${leader.id}`, { cookie: manager.cookie }));
    expect(detail.registration.carRego).toBe('S123ABC');

    // Not for young people; not for strangers.
    const youth = people.find((p) => p.kind === 'youth')!;
    expect((await api(`/events/${eventId}/registrations/${youth.id}/rego`, { cookie: scanner.cookie, body: { rego: null } })).status).toBe(404);
    const stranger = await createUser();
    expect((await api(`/events/${eventId}/registrations/${leader.id}/rego`, { cookie: stranger.cookie, body: { rego: null } })).status).toBe(403);
  });
});
