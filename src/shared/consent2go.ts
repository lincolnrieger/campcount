import type { PreparedRow } from './myscout';
import { flagDuplicates, parsePhotoConsent } from './myscout';
import type { SECTIONS } from './sections';

/**
 * Consent2Go exports: one workbook, a tab per group, a title row, then a
 * header row of school-style columns ("Student ID", "HomeRoom", "Year"…).
 * Scouts SA registers people in MyScout; activity consent and dietary needs
 * come from Consent2Go. People are matched on membership number, which
 * Consent2Go holds in "Student ID".
 */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Consent2Go column → what it is. */
const COLUMNS = {
  memberNumber: ['student id', 'studentid', 'membership number', 'member number'],
  student: ['student', 'name', 'full name'],
  firstName: ['firstname', 'first name', 'given name'],
  lastName: ['lastname', 'last name', 'surname'],
  homeRoom: ['homeroom', 'home room'],
  house: ['house'],
  year: ['year', 'year level'],
  photo: ['photo use authorised', 'photo use authorized', 'photo consent'],
  dietaryOther: ['non-medical dietary requirements'],
  dietary1: ['dietary requirement 1'],
  dietary2: ['dietary requirement 2'],
} as const;

/**
 * Columns kept on each person's profile, under these names. The medication
 * ones are health information: only people who can see dietary detail see
 * them (see HEALTH_EXTRA_FIELDS).
 */
const EXTRA = [
  { header: 'swimming ability', label: 'Swimming ability' },
  { header: 'swimming comments', label: 'Swimming comments' },
  { header: 'paracetamolok', label: 'Paracetamol OK' },
  { header: 'anti-histamineok', label: 'Antihistamine OK' },
  { header: 'anti-inflammatoryok', label: 'Anti-inflammatory OK' },
  { header: 'ibuprofenok', label: 'Ibuprofen OK' },
  { header: 'other medications', label: 'Other medications' },
  { header: 'other support details', label: 'Other support details' },
] as const;

/** Extra fields that are health information, hidden from anyone who can't see dietary detail. */
export const HEALTH_EXTRA_FIELDS = ['Paracetamol OK', 'Antihistamine OK', 'Anti-inflammatory OK', 'Ibuprofen OK', 'Other medications', 'Other support details'];

export function isHealthExtra(label: string): boolean {
  return HEALTH_EXTRA_FIELDS.includes(label) || /medic|paracetamol|histamine|inflammator|ibuprofen|allerg/i.test(label);
}

/** The section for a Consent2Go row: Joeys, Cubs, Scouts, Venturers or Rovers by name; everyone else is a leader. */
export function c2gSection(text: string): (typeof SECTIONS)[number] {
  const t = text.toLowerCase();
  if (/joey/.test(t)) return 'Joeys';
  if (/\bcub/.test(t)) return 'Cubs';
  if (/venturer/.test(t)) return 'Venturers';
  if (/rover/.test(t)) return 'Rovers';
  if (/scout/.test(t)) return 'Scouts';
  return 'Leaders';
}

const hasSectionWord = (text: string) => /joey|\bcub|venturer|rover|scout|leader/i.test(text);

function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] ?? []).map(norm);
    if (cells.some((c) => (COLUMNS.memberNumber as readonly string[]).includes(c))) return i;
  }
  return -1;
}

export interface Consent2GoTab {
  name: string;
  people: number;
  /** Why a tab was skipped (no "Student ID" column). */
  skipped?: string;
}

/** Turn every tab of a Consent2Go workbook into import rows (plus a summary of the tabs). */
export function prepareConsent2Go(sheets: { name: string; rows: string[][] }[]): { prepared: PreparedRow[]; tabs: Consent2GoTab[] } {
  const prepared: PreparedRow[] = [];
  const tabs: Consent2GoTab[] = [];
  for (const sheet of sheets) {
    const h = findHeader(sheet.rows);
    if (h < 0) {
      if (sheet.rows.some((r) => r.some((c) => c.trim()))) tabs.push({ name: sheet.name, people: 0, skipped: 'No "Student ID" column' });
      continue;
    }
    const headers = (sheet.rows[h] ?? []).map(norm);
    const col = (names: readonly string[]) => headers.findIndex((x) => names.includes(x));
    const at = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, col(names)])) as Record<keyof typeof COLUMNS, number>;
    const extras = EXTRA.map((e) => ({ ...e, index: headers.indexOf(e.header) })).filter((e) => e.index >= 0);
    const tabIsGroup = !hasSectionWord(sheet.name);
    let people = 0;
    sheet.rows.slice(h + 1).forEach((r, i) => {
      const get = (index: number) => (index >= 0 ? (r[index] ?? '').trim() : '');
      if (!r.some((c) => c.trim())) return;
      people++;
      let firstName = get(at.firstName);
      let lastName = get(at.lastName);
      // Some exports only have "Student" as "Last, First" or "First Last".
      if ((!firstName || !lastName) && get(at.student)) {
        const s = get(at.student);
        const [a, b] = s.includes(',') ? s.split(',').map((x) => x.trim()).reverse() : [s.split(/\s+/)[0], s.split(/\s+/).slice(1).join(' ')];
        firstName ||= a ?? '';
        lastName ||= b ?? '';
      }
      const memberNumber = get(at.memberNumber).replace(/\s+/g, '');
      const where = [sheet.name, get(at.homeRoom), get(at.house), get(at.year)].join(' ');
      const section = c2gSection(where);
      const kind = section === 'Leaders' ? 'adult' : 'youth';
      const groupName = tabIsGroup ? sheet.name : get(at.homeRoom) || get(at.house);
      const dietaryText = [get(at.dietary1), get(at.dietary2), get(at.dietaryOther)].filter(Boolean).join('; ');
      const errors: string[] = [];
      if (!/^[A-Za-z0-9-]{1,20}$/.test(memberNumber)) errors.push(memberNumber ? 'Student ID (membership number) is not valid' : 'Student ID (membership number) is missing');
      if (!firstName) errors.push('First name is missing');
      if (!lastName) errors.push('Last name is missing');
      prepared.push({
        line: h + i + 2,
        where: `${sheet.name}, row ${h + i + 2}`,
        errors,
        dietaryText,
        row: {
          memberNumber,
          firstName: firstName.slice(0, 60),
          preferredName: '',
          lastName: lastName.slice(0, 60),
          kind,
          section,
          groupName: groupName.slice(0, 120),
          position: '',
          roleLabel: '',
          team: '',
          sourceStatus: '',
          photoConsent: at.photo >= 0 ? parsePhotoConsent(get(at.photo)) : 'unknown',
          ...(extras.length ? { extra: Object.fromEntries(extras.map((e) => [e.label, get(e.index).slice(0, 200)])) } : {}),
        },
      });
    });
    tabs.push({ name: sheet.name, people });
  }
  flagDuplicates(prepared);
  return { prepared, tabs };
}
