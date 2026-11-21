import { prepareConsent2Go } from '../../shared/consent2go';
import { parseDelimited } from '../../shared/csv';
import type { FilePerson } from '../../shared/localIntake';
import { positionSection } from '../../shared/localIntake';
import { autoMap, flagDuplicates, missingRequired, prepareRows } from '../../shared/myscout';
import { deleteSnapshot, loadSnapshot, saveSnapshot } from '../offline/db';
import { readFirstSheet, readSheets } from './xlsx';

export type Source = 'myscout' | 'consent2go';
export const SOURCE_NAME: Record<Source, string> = { myscout: 'MyScout', consent2go: 'Consent2Go' };

export interface ReadFile {
  source: Source;
  fileName: string;
  people: FilePerson[];
  /** Rows that couldn't be used, so nothing goes unnoticed. */
  problems: { where: string; errors: string[] }[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function c2gHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) if ((rows[i] ?? []).some((c) => ['student id', 'studentid'].includes(norm(c)))) return i;
  return -1;
}

/** Read a MyScout or Consent2Go export, working out which it is from its columns. Entirely on this computer. */
export async function readIntakeFile(file: File): Promise<ReadFile> {
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isXlsx && !/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error(`${file.name}: choose an .xlsx or .csv export.`);
  if (isXlsx) {
    const buffer = await file.arrayBuffer();
    const sheets = await readSheets(buffer);
    if (sheets.some((s) => c2gHeader(s.rows) >= 0)) return readConsent2Go(file.name, sheets);
    return readMyScout(file.name, (await readFirstSheet(buffer)).filter((r) => r.some((c) => c.trim())));
  }
  const parsed = parseDelimited(await file.text());
  return readMyScout(file.name, [parsed.headers, ...parsed.rows]);
}

function readMyScout(fileName: string, all: string[][]): ReadFile {
  const [head = [], ...rows] = all;
  const headers = head.map((h) => h.trim());
  const mapping = autoMap(headers);
  if (missingRequired(mapping).length) {
    throw new Error(`${fileName}: this doesn’t look like a MyScout or Consent2Go export (it needs member_number, first_name and last_name columns).`);
  }
  const prepared = prepareRows(rows, mapping);
  flagDuplicates(prepared);
  const people: FilePerson[] = [];
  const problems: ReadFile['problems'] = [];
  for (const p of prepared) {
    const where = `Line ${p.line}`;
    if (p.errors.length) {
      problems.push({ where, errors: p.errors });
      continue;
    }
    const r = p.row;
    people.push({
      memberNumber: r.memberNumber,
      firstName: r.firstName,
      preferredName: r.preferredName,
      lastName: r.lastName,
      position: r.position,
      section: positionSection(r.position),
      groupName: r.groupName,
      photo: r.photoConsent,
      dietaryText: p.dietaryText,
      roleLabel: r.roleLabel,
      team: r.team,
      sourceStatus: r.sourceStatus,
      where,
    });
  }
  return { source: 'myscout', fileName, people, problems };
}

function readConsent2Go(fileName: string, sheets: { name: string; rows: string[][] }[]): ReadFile {
  const { prepared } = prepareConsent2Go(sheets);
  const people: FilePerson[] = [];
  const problems: ReadFile['problems'] = [];
  for (const p of prepared) {
    const where = p.where ?? `Row ${p.line}`;
    // A missing or odd Student ID is fine: they can still be matched to MyScout by name.
    const blocking = p.errors.filter((e) => !/Student ID/.test(e));
    if (blocking.length) {
      problems.push({ where, errors: blocking });
      continue;
    }
    const r = p.row;
    people.push({
      memberNumber: p.errors.some((e) => /Student ID/.test(e)) ? '' : r.memberNumber,
      firstName: r.firstName,
      preferredName: '',
      lastName: r.lastName,
      position: '',
      section: r.section as FilePerson["section"],
      groupName: r.groupName,
      photo: r.photoConsent,
      dietaryText: p.dietaryText,
      roleLabel: '',
      team: '',
      sourceStatus: '',
      extra: r.extra,
      where,
    });
  }
  if (people.length === 0 && problems.length === 0) throw new Error(`${fileName}: no people found in this Consent2Go export.`);
  return { source: 'consent2go', fileName, people, problems };
}

// ---------------------------------------------------------------- kept on this computer only

/** What this browser remembers for one camp: the latest of each file, sections chosen, and dietary notes already done. */
export interface LocalImport {
  version: 1;
  files: Partial<Record<Source, { fileName: string; at: string; people: FilePerson[]; problems: ReadFile['problems'] }>>;
  /** Sections chosen by hand, by membership key. */
  chosen: Record<string, string>;
  /** Dietary notes already done, by membership key: the notes as they were. */
  dietaryDone: Record<string, string>;
}

const storageKey = (eventId: string) => `import:${eventId}`;
export const emptyLocal = (): LocalImport => ({ version: 1, files: {}, chosen: {}, dietaryDone: {} });

/**
 * Kept in this browser's on-device store (IndexedDB), alongside the offline
 * scanning data, and wiped with it on sign-out. Never sent to the server.
 */
export async function loadLocal(eventId: string): Promise<LocalImport> {
  try {
    const v = await loadSnapshot<LocalImport>(storageKey(eventId));
    return v?.version === 1 ? { ...emptyLocal(), ...v } : emptyLocal();
  } catch {
    return emptyLocal();
  }
}

export function saveLocal(eventId: string, value: LocalImport): void {
  // If the browser won't store it, everything still works for this visit.
  saveSnapshot(storageKey(eventId), value).catch(() => undefined);
}

export function clearLocal(eventId: string): Promise<void> {
  return deleteSnapshot(storageKey(eventId)).catch(() => undefined);
}
