import { describe, expect, it } from 'vitest';
import { STARTING_LEVELS, kindForLevel, normalizeLevel, parseLevelSettings, levelStyle, textOn, withLevels } from '../src/shared/levels';
import { api, createEvent, createUser, grant, json } from './helpers';

const row = (participantId: string, level: string) => ({
  participantId,
  firstName: `P${participantId}`,
  lastName: 'Example',
  level,
  groupName: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

describe('level helpers', () => {
  it('has nothing built in beyond a plain starting pair', () => {
    expect(parseLevelSettings(null).map((s) => s.name)).toEqual(['Participants', 'Leaders']);
    expect(STARTING_LEVELS.map((s) => s.youth)).toEqual([true, false]);
  });

  it('matches names without case, adds new ones, and reads adult-sounding names as adults', () => {
    const s = parseLevelSettings(JSON.stringify([{ name: 'Year 7', word: 'Y7', colour: '#C8102E', youth: true }]));
    expect(normalizeLevel('year 7', s)).toBe('Year 7');
    expect(normalizeLevel('Year 8', s)).toBe('Year 8');
    const { levels, added } = withLevels(s, ['Year 7', 'Year 8', 'Staff', 'Parent helpers']);
    expect(added).toEqual(['Year 8', 'Staff', 'Parent helpers']);
    expect(kindForLevel('Year 8', levels)).toBe('youth');
    expect(kindForLevel('Staff', levels)).toBe('adult');
    expect(kindForLevel('Parent helpers', levels)).toBe('adult');
    expect(levelStyle(s, 'Year 7')).toMatchObject({ word: 'Y7', bg: '#C8102E', fg: '#FFFFFF' });
    expect(textOn('#FFC82E')).toBe('#1A1A1A');
  });
});

describe('a camp’s own levels', () => {
  it('adds levels from imports, renames them (moving everyone), and removes empty ones', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const people = async () => {
      const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
      return Object.fromEntries((registrations as { participantId: string; level: string; kind: string }[]).map((r) => [r.participantId, `${r.level}/${r.kind}`]));
    };
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('1', 'Rangers'), row('2', 'Seniors'), row('3', 'Leaders'), row('4', '')] } });
    expect(await people()).toEqual({ '1': 'Rangers/youth', '2': 'Seniors/youth', '3': 'Leaders/adult', '4': 'Participants/youth' });

    const { event } = await json(await api(`/events/${eventId}`, { cookie: manager.cookie }));
    expect((event.levels as { name: string }[]).map((s) => s.name)).toEqual(['Participants', 'Leaders', 'Rangers', 'Seniors']);
    const levels = (event.levels as { name: string; word: string; colour: string; youth: boolean }[]).map((s) => ({ ...s, from: s.name }));
    const next = [
      ...levels.map((s) => (s.name === 'Rangers' ? { ...s, name: 'Ranger Crew', youth: false } : s.name === 'Leaders' ? { ...s, name: 'Adults' } : s)),
      { name: 'Adult Helpers', word: 'Helper', colour: '#336699', youth: false },
    ];
    const res = await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { levels: next } });
    expect(res.status).toBe(200);
    expect(((await json(res)).event.levels as { name: string }[]).map((s) => s.name)).toEqual(['Participants', 'Adults', 'Ranger Crew', 'Seniors', 'Adult Helpers']);
    expect(await people()).toMatchObject({ '1': 'Ranger Crew/adult', '2': 'Seniors/youth', '3': 'Adults/adult' });

    // Imports file people under the camp's names, case aside.
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('5', 'ranger crew'), row('6', 'Adult Helpers')] } });
    expect(await people()).toMatchObject({ '5': 'Ranger Crew/adult', '6': 'Adult Helpers/adult' });

    // Lanyards use the camp's word and colour.
    await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
    const printed = (await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }))).cards as { level: string; style: { word: string; bg: string } }[];
    expect(printed.find((c) => c.level === 'Adult Helpers')!.style).toMatchObject({ word: 'Helper', bg: '#336699' });

    // A level can't be removed while people are in it; two levels can't share a name.
    const current = ((await json(await api(`/events/${eventId}`, { cookie: manager.cookie }))).event.levels as { name: string }[]).map((s) => ({ ...s, from: s.name }));
    expect((await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { levels: current.filter((s) => s.name !== 'Seniors') } })).status).toBe(409);
    const dupes = [...current, { name: 'seniors', word: '', colour: '#000000', youth: true }];
    expect((await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { levels: dupes } })).status).toBe(400);
  });
});
