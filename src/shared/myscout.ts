import type { ImportRow } from './schemas';
import { SECTIONS } from './sections';

/** CampCount fields a source column can be mapped to. */
export const TARGET_FIELDS = {
  memberNumber: { label: 'Membership number', required: true, aliases: ['member_number', 'membership number', 'member number', 'member no'] },
  firstName: { label: 'First name', required: true, aliases: ['first_name', 'first name', 'given name'] },
  preferredName: { label: 'Preferred name', required: false, aliases: ['preferred_name', 'preferred name', 'nickname'] },
  lastName: { label: 'Last name', required: true, aliases: ['last_name', 'last name', 'surname', 'family name'] },
  role: { label: 'Role', required: false, aliases: ['role'] },
  formation: { label: 'Group or unit', required: false, aliases: ['formation', 'group', 'unit'] },
  position: { label: 'Position', required: false, aliases: ['position'] },
  team: { label: 'Team', required: false, aliases: ['team', 'patrol', 'six'] },
  status: { label: 'Registration status', required: false, aliases: ['status'] },
  age: { label: 'Age in years (used only to tell youth from adults)', required: false, aliases: ['age_years', 'age'] },
  photo: { label: 'Photo consent', required: false, aliases: ['photo_approval', 'photo consent', 'photo permission'] },
  dietaryText: {
    label: 'Dietary / medical notes (reviewed, never uploaded)',
    required: false,
    aliases: ['medical_conditions', 'dietary', 'dietary requirements', 'dietaries'],
  },
} as const;

export type TargetField = keyof typeof TARGET_FIELDS;
export type ColumnMapping = Partial<Record<TargetField, number>>;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalised = headers.map(norm);
  for (const [field, def] of Object.entries(TARGET_FIELDS) as [TargetField, (typeof TARGET_FIELDS)[TargetField]][]) {
    const index = normalised.findIndex((h) => (def.aliases as readonly string[]).includes(h));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping): TargetField[] {
  return (Object.keys(TARGET_FIELDS) as TargetField[]).filter((f) => TARGET_FIELDS[f].required && mapping[f] === undefined);
}

const ADULT_ROLE = /leader|rover|adult|helper|staff|parent|volunteer|commissioner/i;

export function deriveKind(role: string, position: string, age: string): 'youth' | 'adult' {
  const years = Number.parseInt(age, 10);
  if (Number.isFinite(years)) return years >= 18 ? 'adult' : 'youth';
  return ADULT_ROLE.test(role) || ADULT_ROLE.test(position) ? 'adult' : 'youth';
}

export function deriveSection(kind: 'youth' | 'adult', formation: string, position: string): (typeof SECTIONS)[number] {
  if (kind === 'adult') return 'Leaders';
  const text = `${formation} ${position}`;
  if (/joey/i.test(text)) return 'Joeys';
  if (/cub/i.test(text)) return 'Cubs';
  if (/venturer/i.test(text)) return 'Venturers';
  if (/rover/i.test(text)) return 'Rovers';
  if (/scout/i.test(text)) return 'Scouts';
  return 'Other';
}

export function parsePhotoConsent(value: string): 'yes' | 'no' | 'unknown' {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'granted'].includes(v)) return 'yes';
  if (['false', 'no', 'n', '0', 'declined'].includes(v)) return 'no';
  return 'unknown';
}

export interface PreparedRow {
  /** 1-based line in the source file (header is line 1). */
  line: number;
  row: Omit<ImportRow, 'dietaryFingerprint' | 'dietary'>;
  /** Source dietary/medical text. Stays in the browser; only shown in the review step. */
  dietaryText: string;
  errors: string[];
}

/** Turn source rows into CampCount rows, keeping only allowlisted fields. */
export function prepareRows(rows: string[][], mapping: ColumnMapping): PreparedRow[] {
  const get = (r: string[], f: TargetField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim());
  return rows.map((r, i) => {
    const errors: string[] = [];
    const memberNumber = get(r, 'memberNumber');
    const firstName = get(r, 'firstName');
    const lastName = get(r, 'lastName');
    if (!/^[A-Za-z0-9-]{1,20}$/.test(memberNumber)) errors.push(memberNumber ? 'Membership number is not valid' : 'Membership number is missing');
    if (!firstName) errors.push('First name is missing');
    if (!lastName) errors.push('Last name is missing');
    const role = get(r, 'role');
    const position = get(r, 'position');
    const formation = get(r, 'formation');
    const kind = deriveKind(role, position, get(r, 'age'));
    return {
      line: i + 2,
      errors,
      dietaryText: get(r, 'dietaryText'),
      row: {
        memberNumber,
        firstName: firstName.slice(0, 60),
        preferredName: get(r, 'preferredName').slice(0, 60),
        lastName: lastName.slice(0, 60),
        kind,
        section: deriveSection(kind, formation, position),
        groupName: formation.slice(0, 120),
        position: position.slice(0, 120),
        roleLabel: role.slice(0, 60),
        team: get(r, 'team').slice(0, 60),
        sourceStatus: get(r, 'status').slice(0, 160),
        photoConsent: mapping.photo === undefined ? 'unknown' : parsePhotoConsent(get(r, 'photo')),
      },
    };
  });
}

/** Mark every row after the first with the same membership number as an error. */
export function flagDuplicates(prepared: PreparedRow[]): void {
  const firstLine = new Map<string, number>();
  for (const p of prepared) {
    const key = p.row.memberNumber.toUpperCase();
    if (!key) continue;
    const seen = firstLine.get(key);
    if (seen !== undefined) p.errors.push(`Same membership number as line ${seen}`);
    else firstLine.set(key, p.line);
  }
}

/** Normalise dietary text before fingerprinting so whitespace/case edits don't trigger review. */
export function normaliseDietaryText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
