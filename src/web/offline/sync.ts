import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../api';
import type { OutboxEntry } from './db';
import { countUnsynced, getDeviceId, markSynced, pruneSynced, unsynced } from './db';

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

function set(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}

/** Push queued scans to the server. Safe to call at any time; never runs twice at once. */
export async function syncNow(): Promise<void> {
  if (running) return;
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
        else if (err instanceof ApiFailure && err.status === 401) set({ state: 'blocked', message: 'Sign in again to upload waiting scans.' });
        else set({ state: 'blocked', message: err instanceof ApiFailure ? err.message : 'Upload failed.' });
        break;
      }
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
  timer = setInterval(() => void syncNow(), 10_000);
  window.addEventListener('online', () => void syncNow());
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
