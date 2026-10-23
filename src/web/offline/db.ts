/**
 * On-device storage for offline scanning (IndexedDB).
 *
 * Holds only what a scanning screen needs: the current context snapshot
 * (display names and credential hashes) and the queue of scans waiting to
 * sync. Cleared on sign-out. Never holds raw card tokens or typed codes.
 */
import type { ScanUploadItem } from '../../shared/schemas';

const DB_NAME = 'campcount';
const DB_VERSION = 1;

export interface OutboxEntry {
  id: string;
  eventId: string;
  contextKey: string;
  item: ScanUploadItem;
  registrationId: string | null;
  createdAt: string;
  synced: 0 | 1;
  /** Local (optimistic) result shown at scan time. */
  local: { outcome: string; message: string; warning: string | null };
  /** Authoritative result from the server once synced. */
  server?: { outcome: string; message: string; warning: string | null };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta');
      db.createObjectStore('snapshots');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('synced', 'synced');
      outbox.createIndex('context', 'contextKey');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function getDeviceId(): Promise<string> {
  const meta = await store('meta', 'readwrite');
  const existing = (await request(meta.get('deviceId'))) as string | undefined;
  if (existing) return existing;
  const id = crypto.randomUUID().replace(/-/g, '');
  await request((await store('meta', 'readwrite')).put(id, 'deviceId'));
  return id;
}

export async function saveSnapshot(key: string, snapshot: unknown): Promise<void> {
  await request((await store('snapshots', 'readwrite')).put(snapshot, key));
}

export async function loadSnapshot<T>(key: string): Promise<T | undefined> {
  return (await request((await store('snapshots')).get(key))) as T | undefined;
}

export async function addToOutbox(entry: OutboxEntry): Promise<void> {
  // Written before feedback is shown, so a scan survives a crash or reload.
  await request((await store('outbox', 'readwrite')).put(entry));
}

export async function unsynced(limit = 100): Promise<OutboxEntry[]> {
  const index = (await store('outbox')).index('synced');
  const all = (await request(index.getAll(IDBKeyRange.only(0), limit))) as OutboxEntry[];
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countUnsynced(): Promise<number> {
  return request((await store('outbox')).index('synced').count(IDBKeyRange.only(0)));
}

export async function contextEntries(contextKey: string): Promise<OutboxEntry[]> {
  const all = (await request((await store('outbox')).index('context').getAll(IDBKeyRange.only(contextKey)))) as OutboxEntry[];
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function markSynced(results: Map<string, OutboxEntry['server']>): Promise<void> {
  const s = await store('outbox', 'readwrite');
  await Promise.all(
    [...results].map(async ([id, server]) => {
      const entry = (await request(s.get(id))) as OutboxEntry | undefined;
      if (entry) await request(s.put({ ...entry, synced: 1, server }));
    }),
  );
}

/** Drop synced history older than a day. Unsynced scans are never discarded. */
export async function pruneSynced(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const s = await store('outbox', 'readwrite');
  const synced = (await request(s.index('synced').getAll(IDBKeyRange.only(1)))) as OutboxEntry[];
  await Promise.all(synced.filter((e) => e.createdAt < cutoff).map((e) => request(s.delete(e.id))));
}

/** Wipe cached rosters. Refuses while scans are waiting to sync unless forced. */
export async function clearDevice(force = false): Promise<boolean> {
  if (!force && (await countUnsynced()) > 0) return false;
  const db = await open();
  await Promise.all(
    ['snapshots', 'outbox'].map((name) => request(db.transaction(name, 'readwrite').objectStore(name).clear())),
  );
  return true;
}
