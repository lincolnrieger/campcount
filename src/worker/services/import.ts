import type { ImportRow } from '../../shared/schemas';

export interface ExistingRegistration {
  registration_id: string;
  participant_id: string;
  first_name: string;
  last_name: string;
  kind: string;
  level: string;
  group_name: string;
  photo_consent: string;
  status: 'active' | 'withdrawn';
  dietary_source_hash: string | null;
}

export type RowAction = 'create' | 'update' | 'unchanged';

export interface RowPlan {
  index: number;
  participantId: string;
  action: RowAction;
  changes: string[];
  /** The source dietary text changed and has not been reviewed in this import. */
  dietaryPending: boolean;
}

export interface ImportPlan {
  rows: RowPlan[];
  withdraw: { participantId: string; registrationId: string }[];
  counts: { create: number; update: number; unchanged: number; withdraw: number; dietaryPending: number };
}

const COMPARED: [keyof ImportRow, keyof ExistingRegistration, string][] = [
  ['firstName', 'first_name', 'First name'],
  ['lastName', 'last_name', 'Last name'],
  ['kind', 'kind', 'Youth or adult'],
  ['level', 'level', 'Level'],
  ['groupName', 'group_name', 'Group'],
  ['photoConsent', 'photo_consent', 'Photo consent'],
];

/** Find participant IDs that appear more than once in the file. */
export function duplicateParticipantIds(rows: ImportRow[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const key = row.participantId.toUpperCase();
    if (!key) continue;
    if (seen.has(key)) dupes.add(row.participantId);
    seen.add(key);
  }
  return [...dupes];
}

const nameKey = (first: string, last: string) => `${first}|${last}`.toLowerCase().replace(/[^a-z0-9|]/g, '');

/**
 * Rows without a participant ID: reuse the ID of the one person on this camp
 * with the same first and last name, so importing the same file again updates
 * rather than duplicates. Anyone else gets a new ID from `make`.
 */
export function fillParticipantIds(rows: ImportRow[], existing: ExistingRegistration[], make: () => string): ImportRow[] {
  const byName = new Map<string, string | null>();
  for (const e of existing) {
    const k = nameKey(e.first_name, e.last_name);
    byName.set(k, byName.has(k) ? null : e.participant_id);
  }
  const taken = new Set(rows.map((r) => r.participantId.toUpperCase()).filter(Boolean));
  return rows.map((r) => {
    if (r.participantId) return r;
    const match = byName.get(nameKey(r.firstName, r.lastName));
    if (match && !taken.has(match.toUpperCase())) {
      taken.add(match.toUpperCase());
      return { ...r, participantId: match };
    }
    let id = make();
    while (taken.has(id.toUpperCase())) id = make();
    taken.add(id.toUpperCase());
    return { ...r, participantId: id };
  });
}

/** Pure planning step shared by preview and commit, so what you preview is what you get. */
export function planImport(rows: ImportRow[], existing: ExistingRegistration[], withdrawMissing: boolean): ImportPlan {
  const byId = new Map(existing.map((e) => [e.participant_id.toUpperCase(), e]));
  const planned: RowPlan[] = rows.map((row, index) => {
    const current = byId.get(row.participantId.toUpperCase());
    const dietaryChanged = (current?.dietary_source_hash ?? null) !== row.dietaryFingerprint;
    const dietaryPending = row.dietary === undefined && dietaryChanged && (row.dietaryFingerprint !== null || current !== undefined);
    if (!current) {
      return { index, participantId: row.participantId, action: 'create', changes: [], dietaryPending };
    }
    const changes = COMPARED.filter(([a, b]) => String(row[a] ?? '') !== String(current[b] ?? '')).map(([, , label]) => label);
    if (current.status === 'withdrawn') changes.push('Rejoined');
    if (row.dietary !== undefined) changes.push('Dietary requirements');
    return { index, participantId: row.participantId, action: changes.length > 0 ? 'update' : 'unchanged', changes, dietaryPending };
  });

  const inFile = new Set(rows.map((r) => r.participantId.toUpperCase()));
  const withdraw = withdrawMissing
    ? existing
        .filter((e) => e.status === 'active' && !inFile.has(e.participant_id.toUpperCase()))
        .map((e) => ({ participantId: e.participant_id, registrationId: e.registration_id }))
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
