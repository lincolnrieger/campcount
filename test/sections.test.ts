import { describe, expect, it } from 'vitest';
import { normalizeSection, parseSectionSettings, sectionStyle, textOn } from '../src/shared/sections';
import { api, createEvent, createUser, grant, json } from './helpers';

const row = (memberNumber: string, section: string) => ({
  memberNumber,
  firstName: `P${memberNumber}`,
  preferredName: '',
  lastName: 'Example',
  kind: 'youth',
  section,
  groupName: '',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

describe('section helpers', () => {
  it('maps names, renamed built-ins and unknowns', () => {
    const s = parseSectionSettings(JSON.stringify([{ name: 'Rover Crew', base: 'Rovers', word: 'Rover', colour: '#C8102E', youth: true }]), '["Rover Crew","Scouts"]');
    expect(s.find((x) => x.base === 'Rovers')).toMatchObject({ name: 'Rover Crew', youth: true });
    expect(s.find((x) => x.base === 'Scouts')).toBeTruthy(); // built-ins are always there
    expect(normalizeSection('Rovers', s)).toBe('Rover Crew');
    expect(normalizeSection('rover crew', s)).toBe('Rover Crew');
    expect(normalizeSection('Nonsense', s)).toBe('Other');
    expect(sectionStyle(s, 'Rover Crew')).toMatchObject({ word: 'Rover', bg: '#C8102E', fg: '#FFFFFF' });
    expect(textOn('#FFC82E')).toBe('#1A1A1A');
  });
});

describe('a camp’s own sections', () => {
  it('renames sections (moving everyone), adds new ones, and files imports under them', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const people = async () => {
      const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
      return Object.fromEntries((registrations as { memberNumber: string; section: string; kind: string }[]).map((r) => [r.memberNumber, `${r.section}/${r.kind}`]));
    };
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('1', 'Rovers'), row('2', 'Scouts')] } });

    const { event } = await json(await api(`/events/${eventId}`, { cookie: manager.cookie }));
    const sections = (event.sections as { name: string; base: string; word: string; colour: string; youth: boolean }[]).map((s) => ({ ...s, from: s.name }));
    const next = [
      ...sections.map((s) => (s.base === 'Rovers' ? { ...s, name: 'Rover Crew', youth: false } : s.base === 'Leaders' ? { ...s, name: 'Adults' } : s)),
      { name: 'Adult Helpers', base: 'custom', word: 'Helper', colour: '#336699', youth: false },
    ];
    const res = await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { sections: next } });
    expect(res.status).toBe(200);
    const saved = (await json(res)).event.sections as { name: string }[];
    expect(saved.map((s) => s.name)).toEqual(['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rover Crew', 'Adults', 'Other', 'Adult Helpers']);
    expect(await people()).toEqual({ '1': 'Rover Crew/adult', '2': 'Scouts/youth' });

    // Imports still say "Rovers" and "Leaders": filed under the new names.
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('3', 'Rovers'), row('4', 'Leaders'), row('5', 'Adult Helpers')] } });
    expect(await people()).toMatchObject({ '3': 'Rover Crew/adult', '4': 'Adults/adult', '5': 'Adult Helpers/adult' });

    // Lanyards use the camp's word and colour.
    const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
    expect(cards).toEqual([]); // no cards issued yet
    await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
    const printed = (await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }))).cards as { section: string; style: { word: string; bg: string } }[];
    expect(printed.find((c) => c.section === 'Adult Helpers')!.style).toMatchObject({ word: 'Helper', bg: '#336699' });

    // An added section can't be removed while people are in it; built-ins can't be removed at all.
    const withoutHelpers = (await json(await api(`/events/${eventId}`, { cookie: manager.cookie }))).event.sections
      .filter((s: { base: string }) => s.base !== 'custom')
      .map((s: { name: string }) => ({ ...s, from: s.name }));
    expect((await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { sections: withoutHelpers } })).status).toBe(409);
    const withoutJoeys = withoutHelpers.filter((s: { base: string }) => s.base !== 'Joeys');
    expect((await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { sections: withoutJoeys } })).status).toBe(400);
    const dupes = [...withoutHelpers, { name: 'scouts', base: 'custom', word: '', colour: '#000000', youth: true }];
    expect((await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { sections: dupes } })).status).toBe(400);
  });
});
