import { describe, expect, it } from 'vitest';
import type { FilePerson, RosterPerson } from '../src/shared/localIntake';
import { buildRow, combinedPhoto, dietarySignature, hasDietaryNotes, linkPeople, needsSection, positionSection } from '../src/shared/localIntake';

// Invented people only.
const person = (over: Partial<FilePerson>): FilePerson => ({
  memberNumber: '',
  firstName: 'Ava',
  preferredName: '',
  lastName: 'Example',
  position: '',
  section: null,
  groupName: '',
  photo: 'unknown',
  dietaryText: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  where: 'Line 2',
  ...over,
});
const ms = (memberNumber: string, firstName: string, position: string, over: Partial<FilePerson> = {}) =>
  person({ memberNumber, firstName, position, section: positionSection(position), groupName: 'Example Cub Unit (Monday)', ...over });
const cg = (memberNumber: string, firstName: string, over: Partial<FilePerson> = {}) => person({ memberNumber, firstName, groupName: 'Example Scout Group', section: 'Scouts', ...over });

describe('section from the MyScout position', () => {
  it('sets plain sections and leaves everything else to be chosen', () => {
    expect(['Joey Scout', 'Cub Scout', 'Scout', 'Venturer Scout', 'Rover Scout', 'Adult Helper', 'Joeys', 'cub'].map(positionSection)).toEqual([
      'Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers', 'Leaders', 'Joeys', 'Cubs',
    ]);
    expect(['Assistant Cub Scout Leader', 'Group Leader', 'Venturer Scout Leader', ''].map(positionSection)).toEqual([null, null, null, null]);
  });
});

describe('linking Consent2Go to MyScout', () => {
  it('matches by membership number (ignoring leading zeros), then by name, and keeps the rest apart', () => {
    const roster: RosterPerson[] = [{ id: 'r1', memberNumber: '900', firstName: 'Old', preferredName: '', lastName: 'Timer', section: 'Leaders', groupName: '', position: '', status: 'active' }];
    const { people, unmatched } = linkPeople(
      [ms('0123', 'Ava', 'Cub Scout'), ms('456', 'Ben', 'Assistant Cub Scout Leader', { lastName: 'Bee' })],
      [
        cg('123', 'Ava'),
        cg('', 'Ben', { lastName: 'Bee' }), // no Student ID: matched by name
        cg('', 'Old', { lastName: 'Timer' }), // on the roster already
        cg('789', 'Cara', { lastName: 'New' }), // not in MyScout
        cg('', 'No', { lastName: 'Body' }), // nothing to go on
      ],
      roster,
    );
    const by = (n: string) => people.find((p) => p.memberNumber === n)!;
    expect(by('0123')).toMatchObject({ link: 'number' });
    expect(by('0123').cg?.firstName).toBe('Ava');
    expect(by('456')).toMatchObject({ link: 'name' });
    expect(by('900')).toMatchObject({ link: 'name', roster: { id: 'r1' } });
    expect(by('789').ms).toBeUndefined();
    expect(unmatched.map((u) => u.firstName)).toEqual(['No']);
  });
});

describe('the roster row', () => {
  it('takes the section from the position, keeps the position, the Consent2Go tab as group, and both photo answers', () => {
    const { people } = linkPeople([ms('1', 'Ava', 'Cub Scout', { photo: 'yes' })], [cg('1', 'Ava', { photo: 'no', extra: { 'Swimming ability': 'Strong' } })], []);
    expect(buildRow(people[0]!)).toMatchObject({
      section: 'Cubs',
      kind: 'youth',
      position: 'Cub Scout',
      groupName: 'Example Scout Group',
      photoConsent: 'no',
      dietaryFingerprint: null,
      extra: { 'Photo consent (MyScout)': 'Yes', 'Photo consent (Consent2Go)': 'No', 'Swimming ability': 'Strong' },
    });
  });

  it('asks for a section for leaders, keeps what was chosen, and makes adults of leaders', () => {
    const { people } = linkPeople([ms('2', 'Ben', 'Assistant Cub Scout Leader')], [], []);
    const p = people[0]!;
    expect(needsSection(p, {})).toBe(true);
    expect(buildRow(p)).toMatchObject({ section: 'Other', position: 'Assistant Cub Scout Leader' });
    expect(needsSection(p, { [p.key]: 'Leaders' })).toBe(false);
    expect(buildRow(p, 'Leaders')).toMatchObject({ section: 'Leaders', kind: 'adult' });
  });

  it('keeps a section already on the roster when nothing new says otherwise', () => {
    const roster: RosterPerson[] = [{ id: 'r', memberNumber: '3', firstName: 'Cal', preferredName: '', lastName: 'Example', section: 'Venturers', groupName: '', position: '', status: 'active' }];
    const { people } = linkPeople([ms('3', 'Cal', 'Joey Scout Leader')], [], roster);
    expect(buildRow(people[0]!)).toMatchObject({ section: 'Venturers' });
  });
});

describe('photo and dietary helpers', () => {
  it('treats any "no" as no photos', () => {
    expect(combinedPhoto('yes', 'no')).toBe('no');
    expect(combinedPhoto('yes', 'unknown')).toBe('yes');
    expect(combinedPhoto(undefined, 'unknown')).toBe('unknown');
  });
  it('only asks about real dietary notes, and notices when they change', () => {
    const { people } = linkPeople([ms('4', 'Dee', 'Scout', { dietaryText: 'Nil' })], [cg('4', 'Dee', { dietaryText: '' })], []);
    expect(hasDietaryNotes(people[0]!)).toBe(false);
    const a = linkPeople([ms('4', 'Dee', 'Scout', { dietaryText: 'Vegetarian' })], [], []).people[0]!;
    const b = linkPeople([ms('4', 'Dee', 'Scout', { dietaryText: 'Vegetarian' })], [cg('4', 'Dee', { dietaryText: 'Peanut allergy' })], []).people[0]!;
    expect(hasDietaryNotes(a)).toBe(true);
    expect(dietarySignature(a)).not.toBe(dietarySignature(b));
  });
});
