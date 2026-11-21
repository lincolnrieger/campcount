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

/**
 * The section for a Consent2Go class, as typed in the Year (or HomeRoom,
 * House) column: full words or short codes like "Ldr", "Joey", "Sct",
 * "Ven". Leaders first, so a Venturer listed as a Joey leader is a leader.
 * Null when the class doesn't say.
 */
export function c2gClass(text: string): (typeof SECTIONS)[number] | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const has = (re: RegExp) => words.some((w) => re.test(w));
  if (has(/^(ldr|ldrs|lead|leader|leaders|adult|adults|helper|helpers|parent|parents|volunteer|volunteers|staff)$/)) return 'Leaders';
  if (has(/^jo/)) return 'Joeys';
  if (has(/^cub/)) return 'Cubs';
  if (has(/^ven/)) return 'Venturers';
  if (has(/^rov/)) return 'Rovers';
  if (has(/^(sc|sct|scts|scout|scouts)$/)) return 'Scouts';
  return null;
}

/** The section for a Consent2Go class or tab name; anything that names none is a leader. */
export function c2gSection(text: string): (typeof SECTIONS)[number] {
  return c2gClass(text) ?? 'Leaders';
}

/** A tab named only for a section ("Joeys", "Scout Troop"), rather than for a Scout group. */
const isSectionTab = (name: string) => /^\s*(joeys?|cubs?|scouts?|venturers?|rovers?|leaders?)( (mob|pack|troop|unit|crew|team))?\s*$/i.test(name);

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
    const tabIsGroup = !isSectionTab(sheet.name);
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
      // The class (Year, else HomeRoom or House) says the section; a tab named for a section is the fallback.
      const section = c2gClass(get(at.year)) ?? c2gClass(get(at.homeRoom)) ?? c2gClass(get(at.house)) ?? (tabIsGroup ? 'Other' : c2gSection(sheet.name));
      const kind = section === 'Leaders' ? 'adult' : 'youth';
      // Each tab is a Scout group.
      const groupName = tabIsGroup ? sheet.name.trim() : '';
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
