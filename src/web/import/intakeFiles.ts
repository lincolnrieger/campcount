import { prepareConsent2Go } from '../../shared/consent2go';
import { parseDelimited } from '../../shared/csv';
import type { IntakeSource } from '../../shared/intake';
import { isReviewColumn } from '../../shared/intake';
import type { PreparedRow } from '../../shared/myscout';
import { autoMap, flagDuplicates, missingRequired, prepareRows } from '../../shared/myscout';
import { readFirstSheet, readSheets } from './xlsx';

/** One person as one file has them: what CampCount would take, and every column, as it is in the file. */
export interface SourceRecord {
  source: IntakeSource;
  key: string;
  prepared: PreparedRow;
  /** Every column in the file for this person, in file order. Stays on this computer. */
  raw: [string, string][];
  where: string;
}

export interface ReadFile {
  source: IntakeSource;
  fileName: string;
  records: SourceRecord[];
  /** Rows that couldn't be used (no membership number, a repeat…), so nothing goes unnoticed. */
  problems: { where: string; errors: string[] }[];
}

export const memberKey = (m: string) => m.replace(/\s+/g, '').toUpperCase();
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Find the Consent2Go header row ("Student ID") in the first rows of a tab. */
function c2gHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) if ((rows[i] ?? []).some((c) => ['student id', 'studentid'].includes(norm(c)))) return i;
  return -1;
}

/** Read a MyScout or Consent2Go export, working out which it is from its columns. */
export async function readIntakeFile(file: File): Promise<ReadFile> {
  const isXlsx = /\.xlsx$/i.test(file.name);
  if (!isXlsx && !/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error(`${file.name}: choose an .xlsx or .csv export.`);
  if (isXlsx) {
    const sheets = await readSheets(await file.arrayBuffer());
    if (sheets.some((s) => c2gHeader(s.rows) >= 0)) return readConsent2Go(file.name, sheets);
    return readMyScout(file.name, (await readFirstSheet(await file.arrayBuffer())).filter((r) => r.some((c) => c.trim())));
  }
  const parsed = parseDelimited(await file.text());
  return readMyScout(file.name, [parsed.headers, ...parsed.rows]);
}

function readMyScout(fileName: string, all: string[][]): ReadFile {
  const [head = [], ...rows] = all;
  const headers = head.map((h) => h.trim());
  const mapping = autoMap(headers);
  const missing = missingRequired(mapping);
  if (missing.length) {
    throw new Error(
      `${fileName}: this doesn’t look like a MyScout or Consent2Go export (no ${missing.length > 1 ? 'columns' : 'column'} for membership number, first name and last name). Use “Import with column matching” for other files.`,
    );
  }
  const cells = rows.map((r) => headers.map((_, i) => (r[i] ?? '').trim()));
  const prepared = prepareRows(cells, mapping);
  flagDuplicates(prepared);
  const records: SourceRecord[] = [];
  const problems: ReadFile['problems'] = [];
  prepared.forEach((p, i) => {
    const where = `Line ${p.line}`;
    if (p.errors.length) return problems.push({ where, errors: p.errors });
    records.push({ source: 'myscout', key: memberKey(p.row.memberNumber), prepared: { ...p, where }, raw: headers.map((h, j) => [h || `Column ${j + 1}`, cells[i]![j] ?? '']), where });
  });
  return { source: 'myscout', fileName, records, problems };
}

function readConsent2Go(fileName: string, sheets: { name: string; rows: string[][] }[]): ReadFile {
  const { prepared } = prepareConsent2Go(sheets);
  // Every column of each row, by "Tab, row N", to show next to what was taken.
  const rawAt = new Map<string, [string, string][]>();
  for (const sheet of sheets) {
    const h = c2gHeader(sheet.rows);
    if (h < 0) continue;
    const headers = (sheet.rows[h] ?? []).map((x, j) => x.trim() || `Column ${j + 1}`);
    sheet.rows.slice(h + 1).forEach((r, i) => rawAt.set(`${sheet.name}, row ${h + i + 2}`, headers.map((name, j) => [name, (r[j] ?? '').trim()])));
  }
  const records: SourceRecord[] = [];
  const problems: ReadFile['problems'] = [];
  for (const p of prepared) {
    const where = p.where ?? `Row ${p.line}`;
    if (p.errors.length) {
      problems.push({ where, errors: p.errors });
      continue;
    }
    records.push({ source: 'consent2go', key: memberKey(p.row.memberNumber), prepared: p, raw: [['Tab', where.split(', row')[0] ?? ''], ...(rawAt.get(where) ?? [])], where });
  }
  if (records.length === 0 && problems.length === 0) throw new Error(`${fileName}: no people found in this Consent2Go export.`);
  return { source: 'consent2go', fileName, records, problems };
}

const enc = new TextEncoder();
async function hmac(key: CryptoKey, text: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const hmacKey = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

/**
 * A fingerprint of each filled-in section, group and dietary column for one
 * person, so a later upload can tell what changed without the values ever
 * leaving this computer.
 */
export async function fingerprints(key: CryptoKey, source: IntakeSource, raw: [string, string][]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of raw) {
    if (!isReviewColumn(source, name)) continue;
    const v = value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!v) continue;
    const col = name.replace(/\s+/g, ' ').slice(0, 80);
    if (Object.keys(out).length >= 120) break;
    out[col] = (await hmac(key, `${col}\u0000${v}`)).slice(0, 16);
  }
  return out;
}

/** The full 64-character dietary fingerprint the roster keeps (same scheme as the one-file import). */
export const dietaryFingerprint = (key: CryptoKey, text: string) => hmac(key, text.trim().replace(/\s+/g, ' ').toLowerCase());

/**
 * What's filled in without a check: names from MyScout; photo consent from
 * Consent2Go (else MyScout); swimming and medication answers from Consent2Go.
 */
export function autoDetails(files: Partial<Record<IntakeSource, SourceRecord>>) {
  const ms = files.myscout?.prepared.row;
  const cg = files.consent2go?.prepared.row;
  const photo = [cg?.photoConsent, ms?.photoConsent].find((v) => v === 'yes' || v === 'no') as 'yes' | 'no' | undefined;
  const extra = cg?.extra ? Object.fromEntries(Object.entries(cg.extra).filter(([, v]) => v !== '')) : {};
  return {
    names: ms ? { firstName: ms.firstName, preferredName: ms.preferredName, lastName: ms.lastName } : cg ? { firstName: cg.firstName, preferredName: '', lastName: cg.lastName } : undefined,
    namesFromMyScout: !!ms,
    photoConsent: photo,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}
