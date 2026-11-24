import { describe, expect, it } from 'vitest';
import { kindForLevel, parseYouthLevels } from '../src/shared/levels';
import { api, createEvent, createUser, grant, json } from './helpers';

const row = (participantId: string, level: string, kind: 'youth' | 'adult' = 'youth') => ({
  participantId,
  firstName: `P${participantId}`,
  lastName: 'Example',
  kind,
  level,
  groupName: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

describe('youth levels', () => {
  it('decides youth or adult from the level', () => {
    expect(kindForLevel('Rangers', ['Seniors', 'Rangers'])).toBe('youth');
    expect(kindForLevel('Rangers', ['Seniors'])).toBe('adult');
    expect(kindForLevel('Unknown', ['Seniors'])).toBe('adult');
    expect(parseYouthLevels('nonsense')).toBeNull();
    expect(parseYouthLevels('["Seniors","Rangers"]')).toEqual(['Seniors', 'Rangers']);
  });

  it('is a camp setting that updates everyone on the roster, and later imports and edits', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const kinds = async () => {
      const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
      return Object.fromEntries((registrations as { participantId: string; kind: string }[]).map((r) => [r.participantId, r.kind]));
    };
    // The browser may say otherwise; the camp's levels decide (new levels are youth unless they sound like adults).
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('1', 'Seniors'), row('2', 'Rangers', 'adult'), row('3', 'Leaders', 'youth')] } });
    expect(await kinds()).toEqual({ '1': 'youth', '2': 'youth', '3': 'adult' });

    // Rangers come as helpers at this camp.
    const res = await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { youthLevels: ['Participants', 'Seniors'] } });
    expect(res.status).toBe(200);
    expect((await json(res)).event.youthLevels).toEqual(['Participants', 'Seniors']);
    expect(await kinds()).toEqual({ '1': 'youth', '2': 'adult', '3': 'adult' });

    // A new Ranger from an import, and a Senior moved to Rangers by hand.
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('4', 'Rangers')] } });
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
    const senior = (registrations as { id: string; participantId: string }[]).find((r) => r.participantId === '1')!;
    await api(`/events/${eventId}/registrations/${senior.id}`, { cookie: manager.cookie, method: 'PATCH', body: { level: 'Rangers' } });
    expect(await kinds()).toEqual({ '1': 'adult', '2': 'adult', '3': 'adult', '4': 'adult' });
  });
});
