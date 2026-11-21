import { describe, expect, it } from 'vitest';
import { kindForSection, parseYouthSections } from '../src/shared/sections';
import { api, createEvent, createUser, grant, json } from './helpers';

const row = (memberNumber: string, section: string, kind: 'youth' | 'adult' = 'youth') => ({
  memberNumber,
  firstName: `P${memberNumber}`,
  preferredName: '',
  lastName: 'Example',
  kind,
  section,
  groupName: '',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
});

describe('youth sections', () => {
  it('decides youth or adult from the section', () => {
    expect(kindForSection('Rovers', ['Scouts', 'Rovers'])).toBe('youth');
    expect(kindForSection('Rovers', ['Scouts'])).toBe('adult');
    expect(kindForSection('Leaders', ['Leaders'])).toBe('adult');
    expect(parseYouthSections('nonsense')).toContain('Rovers');
    expect(parseYouthSections('["Scouts","Bogus"]')).toEqual(['Scouts']);
  });

  it('is a camp setting that updates everyone on the roster, and later imports and edits', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const kinds = async () => {
      const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
      return Object.fromEntries((registrations as { memberNumber: string; kind: string }[]).map((r) => [r.memberNumber, r.kind]));
    };
    // The browser may say otherwise; the camp's setting wins.
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('1', 'Scouts'), row('2', 'Rovers', 'adult'), row('3', 'Leaders', 'youth')] } });
    expect(await kinds()).toEqual({ '1': 'youth', '2': 'youth', '3': 'adult' });

    // Rovers come as helpers at this camp.
    const res = await api(`/events/${eventId}`, { cookie: manager.cookie, method: 'PATCH', body: { youthSections: ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Other'] } });
    expect(res.status).toBe(200);
    expect((await json(res)).event.youthSections).toEqual(['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Other']);
    expect(await kinds()).toEqual({ '1': 'youth', '2': 'adult', '3': 'adult' });

    // A new Rover from an import, and a Scout moved to Rovers by hand.
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [row('4', 'Rovers')] } });
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: manager.cookie }));
    const scout = (registrations as { id: string; memberNumber: string }[]).find((r) => r.memberNumber === '1')!;
    await api(`/events/${eventId}/registrations/${scout.id}`, { cookie: manager.cookie, method: 'PATCH', body: { section: 'Rovers' } });
    expect(await kinds()).toEqual({ '1': 'adult', '2': 'adult', '3': 'adult', '4': 'adult' });
  });
});
