import type { ImportRow } from '../../shared/schemas';

export interface ExistingRegistration {
  registration_id: string;
  member_number: string;
  first_name: string;
  preferred_name: string;
  last_name: string;
  kind: string;
  section: string;
  group_name: string;
  position: string;
  role_label: string;
  team: string;
  source_status: string;
  photo_consent: string;
  status: 'active' | 'withdrawn';
  dietary_source_hash: string | null;
  extra_fields: string;
}

export type RowAction = 'create' | 'update' | 'unchanged';

export interface RowPlan {
  index: number;
  memberNumber: string;
  action: RowAction;
  changes: string[];
  /** The source dietary text changed and has not been reviewed in this import. */
  dietaryPending: boolean;
}

export interface ImportPlan {
  rows: RowPlan[];
  withdraw: { memberNumber: string; registrationId: string }[];
  counts: { create: number; update: number; unchanged: number; withdraw: number; dietaryPending: number };
}

const COMPARED: [keyof ImportRow, keyof ExistingRegistration, string][] = [
  ['firstName', 'first_name', 'First name'],
  ['preferredName', 'preferred_name', 'Preferred name'],
  ['lastName', 'last_name', 'Last name'],
  ['kind', 'kind', 'Youth or adult'],
  ['section', 'section', 'Section'],
  ['groupName', 'group_name', 'Group'],
  ['position', 'position', 'Position'],
  ['roleLabel', 'role_label', 'Role'],
  ['team', 'team', 'Team'],
  ['sourceStatus', 'source_status', 'Registration status'],
  ['photoConsent', 'photo_consent', 'Photo consent'],
];

/** Stored extra fields, tolerating anything unexpected. */
export function parseExtra(json: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(json || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Extra fields as stored: keys in order, empty values left out. */
export function storeExtra(extra: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== '').sort(([a], [b]) => a.localeCompare(b))));
}

/** Find membership numbers that appear more than once in the file. */
export function duplicateMemberNumbers(rows: ImportRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const key = row.memberNumber.toUpperCase();
    if (seen.has(key)) dupes.add(row.memberNumber);
    seen.add(key);
  }
  return [...dupes];
}

/** Pure planning step shared by preview and commit, so what you preview is what you get. */
export function planImport(rows: ImportRow[], existing: ExistingRegistration[], withdrawMissing: boolean): ImportPlan {
  const byMember = new Map(existing.map((e) => [e.member_number.toUpperCase(), e]));
  const planned: RowPlan[] = rows.map((row, index) => {
    const current = byMember.get(row.memberNumber.toUpperCase());
    const dietaryChanged = (current?.dietary_source_hash ?? null) !== row.dietaryFingerprint;
    const dietaryPending = row.dietary === undefined && dietaryChanged && (row.dietaryFingerprint !== null || current !== undefined);
    if (!current) {
      return { index, memberNumber: row.memberNumber, action: 'create', changes: [], dietaryPending };
    }
    const changes = COMPARED.filter(([a, b]) => String(row[a] ?? '') !== String(current[b] ?? '')).map(([, , label]) => label);
    if (row.extra) {
      const before = parseExtra(current.extra_fields);
      for (const [k, v] of Object.entries(row.extra)) if ((before[k] ?? '') !== v) changes.push(k);
    }
    if (current.status === 'withdrawn') changes.push('Rejoined');
    if (row.dietary !== undefined) changes.push('Dietary requirements');
    return {
      index,
      memberNumber: row.memberNumber,
      action: changes.length > 0 ? 'update' : 'unchanged',
      changes,
      dietaryPending,
    };
  });

  const inFile = new Set(rows.map((r) => r.memberNumber.toUpperCase()));
  const withdraw = withdrawMissing
    ? existing
        .filter((e) => e.status === 'active' && !inFile.has(e.member_number.toUpperCase()))
        .map((e) => ({ memberNumber: e.member_number, registrationId: e.registration_id }))
    : [];

  const count = (a: RowAction) => planned.filter((p) => p.action === a).length;
  return {
    rows: planned,
    withdraw,
    counts: {
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      withdraw: withdraw.length,
      dietaryPending: planned.filter((p) => p.dietaryPending).length,
    },
  };
}
