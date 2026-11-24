import type { ImportRow } from './schemas';

/**
 * Importing a spreadsheet: the fields CampCount can take, how a file's
 * columns are matched to them, and how rows are prepared. All of this runs on
 * the device that opened the file. Matching is plain word rules, with no
 * network: exact header names first, then headers that contain the words.
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
 * Group). Each column is used once, personal-looking columns are skipped, and
 * so are columns with nothing in them (when `rows` is given).
 */
export function autoMap(headers: string[], rows?: string[][]): ColumnMapping {
  const mapping: ColumnMapping = {};
  // Columns with nothing in them are never matched (when the rows are known).
  const used = new Set<number>(rows ? headers.map((_, i) => i).filter((i) => !rows.some((r) => (r[i] ?? '').trim())) : []);
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
  /** 1-based line in the combined table (header is line 1). */
  line: number;
  /** Where the row is in the file, for workbooks with several tabs ("Juniors, row 5"). */
  where?: string;
  /** The fields that will be sent. */
  row: Omit<ImportRow, 'hasDietaryNotes' | 'dietary'>;
  /** Source dietary text (all chosen columns together). Stays on this device; only shown in the review step. */
  dietaryText: string;
  /** The same text, column by column, so the review can show each one. */
  dietaryParts: { label: string; text: string }[];
  errors: string[];
}

/** Turn file rows into what CampCount will send: only the matched fields, names cut down as chosen. */
export function prepareRows(
  rows: string[][],
  mapping: ColumnMapping,
  names: NameOptions = { firstName: 'full', lastName: 'full' },
  opts: { dietaryColumns?: number[]; origins?: string[]; headers?: string[] } = {},
): PreparedRow[] {
  const get = (r: string[], f: ImportField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim());
  const dietCols = opts.dietaryColumns ?? (mapping.dietary === undefined ? [] : [mapping.dietary]);
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
      ...(opts.origins?.[i] ? { where: opts.origins[i] } : {}),
      errors,
      dietaryText: [...new Set(dietCols.map((c) => (r[c] ?? '').trim()).filter(Boolean))].join('; '),
      dietaryParts: dietCols.map((c) => ({ label: opts.headers?.[c] || 'Dietaries', text: (r[c] ?? '').trim() })).filter((x) => x.text),
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
  const firstLine = new Map<string, string>();
  for (const p of prepared) {
    const key = p.row.participantId.toUpperCase();
    if (!key) continue;
    const seen = firstLine.get(key);
    if (seen !== undefined) p.errors.push(`Same participant ID as ${seen}`);
    else firstLine.set(key, p.where ?? `line ${p.line}`);
  }
}

/** Tidy dietary text (spaces and case) for comparing notes on the device. */
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

/**
 * Every column whose name says it's about diet ("Dietary Requirement 1",
 * "Dietary Requirement 2", "Non-medical dietary requirements"…), with the
 * chosen Dietaries column first, so notes split across columns are read
 * together. Empty when Dietaries isn't being sent.
 */
export function dietaryColumns(headers: string[], mapping: ColumnMapping): number[] {
  if (mapping.dietary === undefined) return [];
  const others = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => i !== mapping.dietary && isDietaryHeader(h));
  return [mapping.dietary, ...others.map((o) => o.i)];
}

/** The first column that can hold dietary needs, for files whose only one is named something like "Medical Conditions". */
export function firstDietaryColumn(headers: string[]): number | undefined {
  const i = headers.findIndex((h) => isDietaryHeader(h));
  return i >= 0 ? i : undefined;
}

/**
 * Columns whose name says they may hold other medical details as well as
 * dietary needs ("Medical Conditions", "Health info"). They're read the same
 * way: shown on this device in the dietary review only, never sent or kept.
 */
export function isMedicalHeader(header: string): boolean {
  const h = header.split(' › ').pop() ?? header;
  return /medic|condition|health|special|requirement|note/i.test(h) && !/diet|allerg|food|meal/i.test(h);
}

/** Does this column look like it holds dietary needs (and not medication)? */
export function isDietaryHeader(header: string): boolean {
  // Judge the column's own name, not the file name it's labelled with when files are joined ("Consent › Dietary").
  const h = header.split(' › ').pop() ?? header;
  return (
    /diet|allerg|intoleran|food|meal|medical|condition|health|special (need|req)|requirement/i.test(h) &&
    !/medication|medicine|medicare|insurance|fund|doctor|\bgp\b|number|\bno\.?$|\bid\b|contact|phone|mobile|emergency|swim|consent/i.test(h)
  );
}


// ---------------------------------------------------------------- workbooks with several tabs

/** The column added when people come from several tabs: which tab each was on. */
export const TAB_COLUMN = 'Tab';

export interface SheetSummary {
  name: string;
  people: number;
  /** Why the tab wasn't read, when it wasn't. */
  skipped?: string;
}

export interface CombinedTable {
  headers: string[];
  rows: string[][];
  /** "Tab, row N" for each row (only when there's more than one tab). */
  origins: string[];
  sheets: SheetSummary[];
}

const isEmptyRow = (r: string[]) => !r.some((c) => (c ?? '').trim());

/**
 * The header row of one tab: of its first ten rows, the one whose cells match
 * the most CampCount fields (exports often put a title above the headers).
 * It must have a name column. Null when no row looks like headers.
 */
export function findHeaderRow(rows: string[][]): number | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const m = autoMap(rows[i]!.map((c) => (c ?? '').trim()));
    if (missingRequired(m).length) continue;
    const score = Object.keys(m).length;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best?.index ?? null;
}

/**
 * Read every tab of a workbook as one table. Each tab's header row is found on
 * its own; columns are lined up by name (ignoring case and spacing), so tabs
 * with different column orders still match. With more than one tab, a "Tab"
 * column says which tab each person was on. Tabs with no names (a summary or
 * instructions tab) are skipped and listed.
 */
export function combineSheets(sheets: { name: string; rows: string[][] }[]): CombinedTable {
  const headers: string[] = [];
  const keyOf = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
  const index = new Map<string, number>();
  const read: { name: string; header: string[]; body: { cells: string[]; row: number }[] }[] = [];
  const summary: SheetSummary[] = [];
  for (const sheet of sheets) {
    const h = findHeaderRow(sheet.rows);
    if (h === null) {
      if (sheet.rows.some((r) => !isEmptyRow(r))) summary.push({ name: sheet.name, people: 0, skipped: 'No name column' });
      continue;
    }
    const header = sheet.rows[h]!.map((c) => (c ?? '').trim());
    const body = sheet.rows
      .map((cells, i) => ({ cells, row: i + 1 }))
      .slice(h + 1)
      .filter((r) => !isEmptyRow(r.cells));
    if (body.length === 0) {
      summary.push({ name: sheet.name, people: 0, skipped: 'No people' });
      continue;
    }
    header.forEach((name, i) => {
      const k = keyOf(name || `Column ${i + 1}`);
      if (!index.has(k)) {
        index.set(k, headers.length);
        headers.push(name || `Column ${i + 1}`);
      }
    });
    read.push({ name: sheet.name, header, body });
    summary.push({ name: sheet.name, people: body.length });
  }
  const several = read.length > 1;
  const tabName = several ? (headers.some((h) => keyOf(h) === keyOf(TAB_COLUMN)) ? 'Sheet tab' : TAB_COLUMN) : null;
  if (tabName) headers.push(tabName);
  const rows: string[][] = [];
  const origins: string[] = [];
  for (const t of read) {
    const at = t.header.map((name, i) => index.get(keyOf(name || `Column ${i + 1}`))!);
    for (const r of t.body) {
      const out = headers.map(() => '');
      at.forEach((col, i) => (out[col] = (r.cells[i] ?? '').trim()));
      if (tabName) out[headers.length - 1] = t.name;
      rows.push(out);
      origins.push(several ? `${t.name}, row ${r.row}` : `Row ${r.row}`);
    }
  }
  return { headers, rows, origins, sheets: summary };
}

// ---------------------------------------------------------------- several spreadsheets

/** Participant IDs compared without spaces, case or leading zeros (spreadsheets drop them). */
export const idKey = (id: string) => id.replace(/\s+/g, '').toUpperCase().replace(/^0+(?=.)/, '');
/** Names compared on letters and digits only, ignoring case. */
const nameKey = (first: string, last: string) => `${first}|${last}`.toLowerCase().replace(/[^\p{L}\p{N}|]/gu, '');

/** One row's participant ID and name, read with that file's own column matches. */
function identity(row: string[], m: ColumnMapping): { id: string; name: string } {
  const get = (f: ImportField) => (m[f] === undefined ? '' : (row[m[f]!] ?? '').trim());
  let first = get('firstName');
  let last = get('lastName');
  if ((!first || m.lastName === undefined) && m.fullName !== undefined) {
    const s = splitFullName(get('fullName'));
    first ||= s.first;
    if (m.lastName === undefined) last = s.last;
  }
  const id = get('participantId');
  return { id: id ? idKey(id) : '', name: first ? nameKey(first, last) : '' };
}

export interface FileMatch {
  name: string;
  people: number;
  /** Rows that matched someone from an earlier file. */
  matched: number;
  /** Rows added as new people. */
  added: number;
  /** How rows were matched: by participant ID, or by name when the file has no IDs. */
  by: 'id' | 'name' | 'first';
  /** Rows not matched because more than one person had that name. */
  ambiguous: number;
}

export interface MarriedTable extends CombinedTable {
  files: FileMatch[];
}

/**
 * Join several spreadsheets into one list of people. The first file is the
 * starting list; each later file's rows are matched to it by participant ID
 * (or, if that file has no ID column, by first and last name, only when the
 * name belongs to exactly one person). Matched rows fill in that person's
 * columns; unmatched rows are added as new people. Columns with the same name
 * are one column: the earlier file's value wins, a later file only fills
 * blanks. Everything happens on the device.
 */
export function marryTables(files: { name: string; table: CombinedTable; columns?: number[] }[]): MarriedTable {
  const headers: string[] = [];
  const keyOf = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
  const colOf = new Map<string, number>();
  // Columns that match the same CampCount field in different files ("Member ID", "Student ID") are one column.
  // Dietary columns never merge: every file's are kept (named after their file), so they can all be read together.
  const col = (h: string, field: ImportField | undefined, f: number) => {
    const dietary = field === 'dietary' || isDietaryHeader(h);
    const k = dietary ? `diet:${f}:${keyOf(h)}` : field ? `field:${field}` : keyOf(h);
    if (!colOf.has(k)) {
      colOf.set(k, headers.length);
      headers.push(dietary && files.length > 1 ? `${files[f]!.name} › ${h}` : h);
    }
    return colOf.get(k)!;
  };
  const people: { cells: Map<number, string>; origin: string; id: string; name: string }[] = [];
  const byId = new Map<string, number>();
  const byName = new Map<string, number | null>();
  const index = (i: number) => {
    const p = people[i]!;
    if (p.id && !byId.has(p.id)) byId.set(p.id, i);
    if (p.name) byName.set(p.name, byName.has(p.name) && byName.get(p.name) !== i ? null : i);
  };
  const report: FileMatch[] = [];

  files.forEach((file, f) => {
    const t = file.table;
    const m = autoMap(t.headers, t.rows);
    const fieldAt = new Map(Object.entries(m).map(([f, i]) => [i, f as ImportField]));
    // A later file adds only the columns chosen for it (its ID and name columns are still used to match people).
    const chosen = f > 0 && file.columns ? new Set(file.columns) : null;
    const cols = t.headers.map((h, i) => (chosen && !chosen.has(i) ? -1 : col(h, fieldAt.get(i), f)));
    const by: FileMatch['by'] = f === 0 ? 'first' : m.participantId !== undefined ? 'id' : 'name';
    const r: FileMatch = { name: file.name, people: t.rows.length, matched: 0, added: 0, by, ambiguous: 0 };
    t.rows.forEach((row, i) => {
      const who = identity(row, m);
      let at: number | undefined;
      if (f > 0) {
        if (who.id) at = byId.get(who.id);
        // Otherwise a name that belongs to exactly one person, as long as their IDs don't differ.
        if (at === undefined && who.name) {
          const hit = byName.get(who.name);
          if (hit === null) r.ambiguous++;
          else if (hit !== undefined && (!who.id || !people[hit]!.id || people[hit]!.id === who.id)) at = hit;
        }
      }
      const origin = `${file.name}: ${t.origins[i] ?? `row ${i + 2}`}`;
      if (at === undefined) {
        people.push({ cells: new Map(), origin, id: who.id, name: who.name });
        at = people.length - 1;
        r.added++;
      } else r.matched++;
      const p = people[at]!;
      row.forEach((v, c) => {
        const value = (v ?? '').trim();
        if (value && cols[c]! >= 0 && !p.cells.get(cols[c]!)) p.cells.set(cols[c]!, value);
      });
      if (!p.id && who.id) p.id = who.id;
      index(at);
    });
    report.push(r);
  });

  return {
    headers,
    rows: people.map((p) => headers.map((_, c) => p.cells.get(c) ?? '')),
    origins: people.map((p) => p.origin),
    // A one-tab file (a CSV, say) is known by its file name; a tab of a workbook by both.
    sheets: files.flatMap((f) =>
      f.table.sheets.map((s) => ({ ...s, name: f.table.sheets.length === 1 ? f.name : files.length > 1 ? `${f.name} › ${s.name}` : s.name })),
    ),
    files: report,
  };
}

/** Columns that look like they hold dietary needs: worth reading together. */
export const DIETARY_COLUMN = /diet|allerg|food|meal/i; // see isDietaryHeader

/**
 * The columns a later spreadsheet adds by default: ones that match a CampCount
 * field, and dietary ones. Everything else is left out unless ticked.
 */
export function defaultFileColumns(table: CombinedTable): number[] {
  const m = autoMap(table.headers, table.rows);
  const fields = new Set(Object.values(m));
  return table.headers
    .map((h, i) => i)
    .filter((i) => fields.has(i) || isDietaryHeader(table.headers[i] ?? ''));
}
