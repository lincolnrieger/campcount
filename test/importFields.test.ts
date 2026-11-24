import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../src/shared/csv';
import { autoMap, flagDuplicates, initial, missingRequired, parsePhotoConsent, prepareRows, splitFullName } from '../src/shared/importFields';

const HEADER = 'Participant ID\tFirst Name\tLast Name\tHome Group Name\tYear Level\tAddress\tDate of Birth\tMobile\tEmail\tMedicare Number\tMedical Conditions\tSwimming Ability\tDietary Requirements\tPhoto Consent';
const ROW_1 = '1001\tSam\tTaylor\tRed Gum Club\tJuniors\t1 Example St\t2014-01-01\t0400000000\tsam@example.test\t123\tAsthma\tStrong\tPeanut allergy\tYes';
const ROW_2 = '1002\tAlex\tNguyen\tSaltbush School\tLeaders\t2 Example St\t1980-01-01\t0400000001\talex@example.test\t456\t\tWeak\t\tNo';

describe('importing a spreadsheet', () => {
  it('matches columns by name, and never matches contact, birth, medical or swimming columns', () => {
    const t = parseDelimited(`${HEADER}\n${ROW_1}\n${ROW_2}`);
    const m = autoMap(t.headers);
    const name = (i: number | undefined) => (i === undefined ? undefined : t.headers[i]);
    expect(name(m.participantId)).toBe('Participant ID');
    expect(name(m.firstName)).toBe('First Name');
    expect(name(m.lastName)).toBe('Last Name');
    expect(name(m.groupName)).toBe('Home Group Name');
    expect(name(m.level)).toBe('Year Level');
    expect(name(m.dietary)).toBe('Dietary Requirements');
    expect(name(m.photoConsent)).toBe('Photo Consent');
    const used = new Set(Object.values(m).map((i) => t.headers[i!]));
    for (const h of ['Address', 'Date of Birth', 'Mobile', 'Email', 'Medicare Number', 'Medical Conditions', 'Swimming Ability']) expect(used.has(h)).toBe(false);
    expect(missingRequired(m)).toEqual([]);
  });

  it('sends only the chosen fields, never anything else from the file', () => {
    const t = parseDelimited(`${HEADER}\n${ROW_1}\n${ROW_2}`);
    const [sam, alex] = prepareRows(t.rows, autoMap(t.headers));
    expect(sam!.row).toEqual({ participantId: '1001', firstName: 'Sam', lastName: 'Taylor', kind: 'youth', level: 'Juniors', groupName: 'Red Gum Club', photoConsent: 'yes' });
    expect(alex!.row.photoConsent).toBe('no');
    // Dietary text stays on the device; only what's confirmed in review is sent.
    expect(sam!.dietaryText).toBe('Peanut allergy');
    const sent = JSON.stringify([sam!.row, alex!.row]);
    for (const secret of ['Example St', '2014', '0400', '@example', '123', 'Asthma', 'Strong', 'Peanut']) expect(sent).not.toContain(secret);
  });

  it('can send initials only, or no last name at all', () => {
    const t = parseDelimited(`${HEADER}\n${ROW_1}`);
    const m = autoMap(t.headers);
    expect(prepareRows(t.rows, m, { firstName: 'full', lastName: 'initial' })[0]!.row).toMatchObject({ firstName: 'Sam', lastName: 'T.' });
    expect(prepareRows(t.rows, m, { firstName: 'initial', lastName: 'none' })[0]!.row).toMatchObject({ firstName: 'S.', lastName: '' });
    expect(initial(' alex')).toBe('A.');
  });

  it('only needs a first name: last name, group, level and ID are optional', () => {
    const t = parseDelimited('Given name\nSam\nAlex');
    const m = autoMap(t.headers);
    expect(missingRequired(m)).toEqual([]);
    const rows = prepareRows(t.rows, m);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(rows[0]!.row).toMatchObject({ firstName: 'Sam', lastName: '', participantId: '', level: '', groupName: '', photoConsent: 'no' });
  });

  it('splits a single name column', () => {
    const t = parseDelimited('Name,Club\n"Taylor, Sam",Red Gum\nAlex Nguyen,Saltbush');
    const m = autoMap(t.headers);
    expect(m.fullName).toBe(0);
    expect(prepareRows(t.rows, m).map((r) => [r.row.firstName, r.row.lastName])).toEqual([
      ['Sam', 'Taylor'],
      ['Alex', 'Nguyen'],
    ]);
    expect(splitFullName('Jo')).toEqual({ first: 'Jo', last: '' });
  });

  it("doesn't mistake a group name for a person's name", () => {
    const m = autoMap(['Club Group Name', 'First', 'Surname']);
    expect(m.groupName).toBe(0);
    expect(m.firstName).toBe(1);
    expect(m.fullName).toBeUndefined();
  });

  it('flags a missing first name, a bad ID and repeated IDs', () => {
    const t = parseDelimited('ID,First name\n1,\nbad id!,Sam\n2,Ana\n2,Ben');
    const rows = prepareRows(t.rows, autoMap(t.headers));
    flagDuplicates(rows);
    expect(rows[0]!.errors).toContain('First name is missing');
    expect(rows[1]!.errors[0]).toMatch(/letters, numbers and dashes/);
    expect(rows[3]!.errors[0]).toMatch(/Same participant ID/);
  });

  it('treats photo consent as Yes only when clearly yes', () => {
    expect(['Yes', 'y', 'TRUE', 'granted', 'OK'].map(parsePhotoConsent)).toEqual(['yes', 'yes', 'yes', 'yes', 'yes']);
    expect(['No', '', 'maybe', 'unknown', 'declined'].map(parsePhotoConsent)).toEqual(['no', 'no', 'no', 'no', 'no']);
  });
});
