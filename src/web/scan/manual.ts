import { api } from '../api';

/** One id per browser tab, so hand-entered scans from the web app are grouped as one device in reports. */
const DEVICE_ID = `web-${crypto.randomUUID().slice(0, 12)}`;

export interface ManualResult {
  outcome: string;
  message: string;
  warning: string | null;
}

/**
 * Record a scan for someone without their card (a latecomer at the gate, a
 * walk-in at an activity). Goes through the same server rules as a scanner,
 * and is recorded as a hand entry.
 */
export async function recordByHand(
  eventId: string,
  scan: { contextType: 'site' | 'activity' | 'meal'; contextId: string | null; direction: 'in' | 'out'; registrationId: string },
): Promise<ManualResult> {
  const res = await api<{ results: ManualResult[] }>(`/events/${eventId}/scans`, {
    body: { deviceId: DEVICE_ID, scans: [{ id: crypto.randomUUID(), deviceTime: new Date().toISOString(), method: 'manual', ...scan }] },
  });
  return res.results[0]!;
}
