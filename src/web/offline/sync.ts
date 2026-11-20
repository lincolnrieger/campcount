import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../api';
import type { OutboxEntry } from './db';
import { clearRosters, countUnsynced, getDeviceId, markSynced, pruneSynced, unsynced } from './db';

export interface SyncStatus {
  pending: number;
  lastSyncAt: string | null;
  state: 'idle' | 'syncing' | 'offline' | 'blocked';
  message: string | null;
}

interface UploadResult {
  results: { id: string; outcome: string; message: string; warning: string | null }[];
}

let status: SyncStatus = { pending: 0, lastSyncAt: null, state: 'idle', message: null };
const listeners = new Set<(s: SyncStatus) => void>();
const syncedListeners = new Set<(results: Map<string, OutboxEntry['server']>) => void>();
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
/** After a failed upload, wait before the timer tries again (doubling, up to 5 minutes, jittered). */
let failures = 0;
let retryAt = 0;

function backOff() {
  failures += 1;
  const base = Math.min(5 * 60_000, 10_000 * 2 ** (failures - 1));
  retryAt = Date.now() + base * (0.5 + Math.random() * 0.5);
}

function set(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}

/** Push queued scans to the server. Safe to call at any time; never runs twice at once. */
export async function syncNow(opts: { scheduled?: boolean } = {}): Promise<void> {
  if (running) return;
  // The 10-second timer respects the back-off; a new scan or regained signal tries at once.
  if (opts.scheduled && Date.now() < retryAt) return;
  running = true;
  try {
    for (;;) {
      const batch = await unsynced(100);
      set({ pending: await countUnsynced() });
      if (batch.length === 0) break;
      if (!navigator.onLine) {
        set({ state: 'offline' });
        break;
      }
      set({ state: 'syncing' });
      const eventId = batch[0]!.eventId;
      const items = batch.filter((e) => e.eventId === eventId);
      let res: UploadResult;
      try {
        res = await api<UploadResult>(`/events/${eventId}/scans`, {
          body: { deviceId: await getDeviceId(), scans: items.map((e) => e.item) },
        });
      } catch (err) {
        if (err instanceof ApiFailure && err.status === 0) set({ state: 'offline', message: null });
        else if (err instanceof ApiFailure && err.status === 401) {
          // Signed out on the server: wipe the offline lists, keep the waiting scans for after sign-in.
          await clearRosters().catch(() => undefined);
          set({ state: 'blocked', message: 'Sign in again to upload waiting scans.' });
        }
        else set({ state: 'blocked', message: err instanceof ApiFailure ? err.message : 'Upload failed.' });
        backOff();
        break;
      }
      failures = 0;
      retryAt = 0;
      const results = new Map(res.results.map((r) => [r.id, { outcome: r.outcome, message: r.message, warning: r.warning }]));
      await markSynced(results);
      syncedListeners.forEach((l) => l(results));
      set({ lastSyncAt: new Date().toISOString(), state: 'idle', message: null });
    }
    await pruneSynced();
  } finally {
    set({ pending: await countUnsynced() });
    running = false;
  }
}

/** Ask for a sync shortly (coalesces bursts of scans into one upload). */
export function requestSync() {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => void syncNow(), 400);
}

function start() {
  if (timer) return;
  timer = setInterval(() => void syncNow({ scheduled: true }), 10_000);
  // Signal back: spread the uploads over a few seconds, so every phone at the
  // gate doesn't upload in the same instant when the mast comes back.
  window.addEventListener('online', () => {
    retryAt = 0;
    setTimeout(() => void syncNow(), Math.random() * 3_000);
  });
  window.addEventListener('offline', () => set({ state: 'offline' }));
  void syncNow();
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(status);
  useEffect(() => {
    start();
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export function onSynced(listener: (results: Map<string, OutboxEntry['server']>) => void): () => void {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}
