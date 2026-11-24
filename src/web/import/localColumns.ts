/**
 * Columns from an import that were NOT sent to CampCount, kept only on the
 * device that did the import (IndexedDB), so the person who imported can
 * still look them up at camp. Never uploaded. Wiped on sign-out with the
 * rest of the device's cached data, or with "Remove from this device".
 */
import { deleteSnapshot, loadSnapshot, saveSnapshot } from '../offline/db';

export interface LocalColumns {
  savedAt: string;
  /** The kept columns' headers, in file order. */
  headers: string[];
  /** Each person's values for those columns, by participant ID (upper case). */
  byId: Record<string, string[]>;
}

const key = (eventId: string) => `local-columns:${eventId}`;

export async function loadLocalColumns(eventId: string): Promise<LocalColumns | null> {
  return (await loadSnapshot<LocalColumns>(key(eventId))) ?? null;
}

/** Keep these rows' other columns on this device, replacing what was kept for the same people. */
export async function saveLocalColumns(eventId: string, headers: string[], rows: { participantId: string; values: string[] }[]): Promise<void> {
  const before = await loadLocalColumns(eventId);
  // Different columns from last time: start again rather than mixing them up.
  const same = before && JSON.stringify(before.headers) === JSON.stringify(headers);
  const byId: Record<string, string[]> = same ? { ...before.byId } : {};
  for (const r of rows) if (r.participantId) byId[r.participantId.toUpperCase()] = r.values;
  await saveSnapshot(key(eventId), { savedAt: new Date().toISOString(), headers, byId } satisfies LocalColumns);
}

export async function clearLocalColumns(eventId: string): Promise<void> {
  await deleteSnapshot(key(eventId));
}
