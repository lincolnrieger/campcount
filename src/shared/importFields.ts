import type { ImportRow } from './schemas';

/**
 * Importing a spreadsheet: the fields CampCount can take, how a file's
 * columns are matched to them, and how rows are prepared. All of this runs on
 * the device that opened the file. Matching is plain word rules (no AI, no
 * network): exact header names first, then headers that contain the words.
 */

/** The fields CampCount can import. Everything else in a file stays on the device. */
export const IMPORT_FIELDS = {
  firstName: {
    label: 'First name',
    required: true,
    aliases: ['first name', 'firstname', 'given name', 'given names', 'forename', 'first', 'preferred name', 'known as'],
  },
  lastName: { label: 'Last name', required: false, aliases: ['last name', 'lastname', 'surname', 'family name', 'last'] },
  /** Only when a file has first and last names in one column. */
  fullName: { label: 'Full name (one column)', required: false, aliases: ['full name', 'name', 'participant name', 'student', 'participant', 'attendee', 'person'] },
  groupName: {
    label: 'Group',
    required: false,
    aliases: ['group', 'group name', 'unit', 'club', 'school', 'formation', 'home group', 'organisation', 'organization', 'branch', 'house'],
  },
  level: {
    label: 'Level',
    required: false,
    aliases: ['level', 'section', 'year', 'year level', 'grade', 'class', 'age group', 'division', 'category', 'role', 'type', 'homeroom', 'home room', 'stream'],
  },
  participantId: {
    label: 'Participant ID',
    required: false,
    aliases: [
      'participant id', 'id', 'member number', 'membership number', 'member no', 'member id', 'membership no', 'student id', 'registration id',
      'registration number', 'reg no', 'reg id', 'number', 'id number', 'person id',
    ],
  },
  dietary: {
    label: 'Dietaries',
    required: false,
    aliases: ['dietaries', 'dietary', 'dietary requirements', 'dietary requirement', 'dietary needs', 'diet', 'special diet', 'food allergies', 'food requirements', 'allergies'],
  },
  photoConsent: {
    label: 'Photo consent',
    required: false,
    aliases: ['photo consent', 'photo', 'photos', 'photo permission', 'photography', 'photo approval', 'media consent', 'photo use authorised', 'photo use authorized'],
  },
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export type ColumnMapping = Partial<Record<ImportField, number>>;

/** The fields offered by default, in order. */
export const IMPORT_FIELD_ORDER: ImportField[] = ['firstName', 'lastName', 'fullName', 'groupName', 'level', 'participantId', 'dietary', 'photoConsent'];

/** How much of a name is sent. */
export type FirstNameMode = 'full' | 'initial';
export type LastNameMode = 'full' | 'initial' | 'none';
export interface NameOptions {
  firstName: FirstNameMode;
  lastName: LastNameMode;
}

/**
 * Columns that look like contact, identity or medical details. They're never
 * matched to a field (except allergies to Dietaries) and never leave the device.
 */
export const PERSONAL_COLUMN =
  /e-?mail|phone|mobile|address|street|suburb|postcode|post code|birth|\bdob\b|guardian|parent|carer|contact|emergency|doctor|insurance|medicare|medic|health|condition|medication|swim/i;

/** Single words too common to match inside a longer header ("Group Name" isn't a name). */
const TOO_LOOSE = new Set(['id', 'name', 'first', 'last', 'number', 'type', 'role', 'class', 'person', 'participant', 'student', 'photo', 'photos', 'year', 'house', 'diet']);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-./()#:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Match a file's columns to CampCount fields. Exact header names win; then a
 * header that contains every word of a field's name ("Home Group Name" →
 * Group). Each column is used once, and personal-looking columns are skipped.
 */
export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const normalised = headers.map(norm);
  const allowed = (i: number, field: ImportField) => !PERSONAL_COLUMN.test(headers[i] ?? '') || (field === 'dietary' && /allerg|diet/i.test(headers[i] ?? ''));
  const fields = IMPORT_FIELD_ORDER;
  // Pass 1: exact names, in each field's alias order.
  for (const field of fields) {
    for (const alias of IMPORT_FIELDS[field].aliases) {
      const i = normalised.findIndex((h, idx) => h === alias && !used.has(idx) && allowed(idx, field));
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
        break;
      }
    }
  }
  // Pass 2: headers containing all the words of an alias (longer aliases first, so "year level" beats "year").
  const loose: ImportField[] = ['groupName', 'level', 'participantId', 'dietary', 'photoConsent', 'firstName', 'lastName', 'fullName'];
  for (const field of loose) {
    if (mapping[field] !== undefined) continue;
    const aliases = [...IMPORT_FIELDS[field].aliases].filter((a) => !TOO_LOOSE.has(a)).sort((a, b) => b.length - a.length);
    outer: for (const alias of aliases) {
      const words = alias.split(' ');
      for (let i = 0; i < normalised.length; i++) {
        if (used.has(i) || !allowed(i, field)) continue;
        const hw = normalised[i]!.split(' ');
        if (words.every((w) => hw.includes(w))) {
          mapping[field] = i;
          used.add(i);
          break outer;
        }
      }
    }
  }
  // A full-name column is only needed when there's no separate first name.
  if (mapping.firstName !== undefined) delete mapping.fullName;
  return mapping;
}

/** Fields that must be matched before going on: a first name, from its own column or a full-name one. */
export function missingRequired(mapping: ColumnMapping): ImportField[] {
  return mapping.firstName === undefined && mapping.fullName === undefined ? ['firstName'] : [];
}

/** Yes only when the file clearly says so; anything else (blank, "no", unclear) is No. */
export function parsePhotoConsent(value: string): 'yes' | 'no' {
  const v = value.trim().toLowerCase();
  return ['true', 'yes', 'y', '1', 'granted', 'ok', 'approved', 'authorised', 'authorized', 'allowed', 'consent given', 'given'].includes(v) ? 'yes' : 'no';
}

/** "Alex" → "A." when only initials are sent. */
export function initial(name: string): string {
  const c = name.trim().charAt(0);
  return c ? `${c.toUpperCase()}.` : '';
}

/** Split "Smith, Alex" or "Alex Smith" into first and last. */
export function splitFullName(full: string): { first: string; last: string } {
  const s = full.trim().replace(/\s+/g, ' ');
  if (s.includes(',')) {
    const [last = '', first = ''] = s.split(',').map((x) => x.trim());
    return { first, last };
  }
  const parts = s.split(' ');
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

export interface PreparedRow {
  /** 1-based line in the source file (header is line 1). */
  line: number;
  /** The fields that will be sent. */
  row: Omit<ImportRow, 'dietaryFingerprint' | 'dietary'>;
  /** Source dietary text. Stays on this device; only shown in the review step. */
  dietaryText: string;
  errors: string[];
}

/** Turn file rows into what CampCount will send: only the matched fields, names cut down as chosen. */
export function prepareRows(rows: string[][], mapping: ColumnMapping, names: NameOptions = { firstName: 'full', lastName: 'full' }): PreparedRow[] {
  const get = (r: string[], f: ImportField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim());
  return rows.map((r, i) => {
    const errors: string[] = [];
    let first = get(r, 'firstName');
    let last = get(r, 'lastName');
    if ((!first || mapping.lastName === undefined) && mapping.fullName !== undefined) {
      const split = splitFullName(get(r, 'fullName'));
      first ||= split.first;
      if (mapping.lastName === undefined) last = split.last;
    }
    const participantId = get(r, 'participantId');
    if (!first) errors.push('First name is missing');
    if (participantId && !/^[A-Za-z0-9-]{1,20}$/.test(participantId)) errors.push('Participant ID can only have letters, numbers and dashes');
    return {
      line: i + 2,
      errors,
      dietaryText: get(r, 'dietary'),
      row: {
        participantId,
        firstName: (names.firstName === 'initial' ? initial(first) : first).slice(0, 60),
        lastName: (names.lastName === 'none' ? '' : names.lastName === 'initial' ? initial(last) : last).slice(0, 60),
        kind: 'youth',
        level: get(r, 'level').slice(0, 40),
        groupName: get(r, 'groupName').slice(0, 120),
        photoConsent: parsePhotoConsent(get(r, 'photoConsent')),
      },
    };
  });
}

/** Mark every row after the first with the same participant ID as an error. */
export function flagDuplicates(prepared: PreparedRow[]): void {
  const firstLine = new Map<string, number>();
  for (const p of prepared) {
    const key = p.row.participantId.toUpperCase();
    if (!key) continue;
    const seen = firstLine.get(key);
    if (seen !== undefined) p.errors.push(`Same participant ID as line ${seen}`);
    else firstLine.set(key, p.line);
  }
}

/** Normalise dietary text before fingerprinting so whitespace/case edits don't trigger review. */
export function normaliseDietaryText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whole notes that only say there's nothing to record. Matched against the
 * entire note (after case, spaces and punctuation are ignored), never a part
 * of it, so "None, but vegetarian" or "Nil except peanuts" never match and
 * still need a person to read them. Abbreviations like NKDA (no known *drug*
 * allergies) are deliberately not here: they say nothing about food.
 */
const SAYS_NOTHING = new Set([
  'nil', 'nill', 'none', 'null', 'n/a', 'na', 'no', 'nothing', 'not applicable', '-', '--', '0',
  'nil known', 'none known', 'nothing known', 'none listed', 'none required', 'not required',
  'no allergies', 'no known allergies', 'no food allergies', 'no requirements', 'no dietary requirements',
  'no dietary needs', 'no special requirements', 'no special dietary requirements', 'nil allergies',
]);

/** Does this dietary note, as a whole, say there is nothing to record? */
export function saysNothing(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[.!,;:'"()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t !== '' && SAYS_NOTHING.has(t);
}
