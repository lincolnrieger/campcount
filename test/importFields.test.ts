import { describe, expect, it } from 'vitest';
import { parseDelimited } from '../src/shared/csv';
import { autoMap, combineSheets, dietaryColumns, findHeaderRow, flagDuplicates, initial, missingRequired, parsePhotoConsent, prepareRows, splitFullName } from '../src/shared/importFields';

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

describe('workbooks with a tab per group', () => {
  // Like many consent and registration exports: a title row, then headers; one tab per group; dietaries split over columns.
  const tab = (name: string, rows: string[][]) => ({ name, rows });
  const HEAD = ['Student ID', 'FirstName', 'LastName', 'Year', 'Photo Use Authorised', 'Medical Conditions', 'Dietary Requirement 1', 'Dietary Requirement 2'];
  const workbook = [
    tab('Red Gum', [
      ['Consent report: Summer Camp', '', ''],
      [],
      HEAD,
      ['1001', 'Ava', 'Nguyen', 'Juniors', 'Yes', 'Asthma', 'Vegetarian', 'No nuts'],
      ['1002', 'Ben', 'Taylor', 'Juniors', 'No', '', '', ''],
    ]),
    // Same columns, different order.
    tab('Saltbush', [
      ['Consent report: Summer Camp'],
      ['LastName', 'FirstName', 'Student ID', 'Year', 'Photo Use Authorised', 'Dietary Requirement 1', 'Medical Conditions', 'Dietary Requirement 2'],
      ['Smith', 'Cal', '1003', 'Leaders', 'Yes', 'Gluten free', '', ''],
    ]),
    tab('Summary', [['Total', '3'], ['Printed', 'today']]),
    tab('Empty', []),
  ];

  it('finds the header row under a title', () => {
    expect(findHeaderRow(workbook[0]!.rows)).toBe(2);
    expect(findHeaderRow(workbook[2]!.rows)).toBeNull();
  });

  it('reads every tab, lines up columns by name, records the tab, and skips tabs with no names', () => {
    const t = combineSheets(workbook);
    expect(t.rows).toHaveLength(3);
    expect(t.headers.at(-1)).toBe('Tab');
    expect(t.sheets).toEqual([
      { name: 'Red Gum', people: 2 },
      { name: 'Saltbush', people: 1 },
      { name: 'Summary', people: 0, skipped: 'No name column' },
    ]);
    const m = autoMap(t.headers);
    const rows = prepareRows(t.rows, m, undefined, { dietaryColumns: dietaryColumns(t.headers, m), origins: t.origins });
    expect(rows.map((r) => [r.row.participantId, r.row.firstName, r.row.lastName, r.row.level, r.row.photoConsent])).toEqual([
      ['1001', 'Ava', 'Nguyen', 'Juniors', 'yes'],
      ['1002', 'Ben', 'Taylor', 'Juniors', 'no'],
      ['1003', 'Cal', 'Smith', 'Leaders', 'yes'],
    ]);
    expect(rows[2]!.where).toBe('Saltbush, row 3');
    // Dietaries split over two columns are read together; medical conditions never are.
    expect(rows[0]!.dietaryText).toBe('Vegetarian; No nuts');
    expect(JSON.stringify(rows.map((r) => r.row))).not.toContain('Asthma');
    // The tab can be sent as the group.
    const tabAt = t.headers.indexOf('Tab');
    expect(prepareRows(t.rows, { ...m, groupName: tabAt }).map((r) => r.row.groupName)).toEqual(['Red Gum', 'Red Gum', 'Saltbush']);
  });

  it('never matches an empty column (an unused "House" column is not the group)', () => {
    const t = combineSheets([tab('A', [['First name', 'House', 'Year'], ['Ava', '', 'Juniors']]), tab('B', [['First name', 'House', 'Year'], ['Ben', '', 'Seniors']])]);
    expect(autoMap(t.headers).groupName).toBe(1);
    const m = autoMap(t.headers, t.rows);
    expect(m.groupName).toBeUndefined();
    expect(m.level).toBe(2);
  });

  it('treats a single tab or CSV the same way, without a Tab column', () => {
    const t = combineSheets([workbook[0]!]);
    expect(t.headers).not.toContain('Tab');
    expect(t.rows).toHaveLength(2);
  });
});
