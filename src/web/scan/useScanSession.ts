import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normaliseShortCode, isShortCode, parseCredentialPayload } from '../../shared/credentials';
import type { ContextRules, ContextType, Direction, Evaluation, PersonState } from '../../shared/scanRules';
import { EMPTY_STATE, evaluateScan } from '../../shared/scanRules';
import { ApiFailure, api } from '../api';
import type { OutboxEntry } from '../offline/db';
import { addToOutbox, contextEntries, getDeviceId, loadSnapshot, saveSnapshot } from '../offline/db';
import { onSynced, requestSync } from '../offline/sync';

export interface SnapshotPerson {
  id: string;
  name: string;
  memberNumber: string;
  group: string;
  section: string;
  kind: 'youth' | 'adult';
  withdrawn: boolean;
  booked: boolean;
  noPhotos?: boolean;
  dietaryAlert?: string | null;
  state: PersonState | null;
}

export interface Snapshot {
  event: { id: string; name: string; timezone: string };
  context: { type: ContextType; id: string | null; name: string; rules: ContextRules };
  generatedAt: string;
  people: SnapshotPerson[];
  credentials: { registrationId: string; tokenHash: string; codeHash: string; revoked: boolean }[];
}

export interface Feedback {
  key: string;
  tone: 'ok' | 'warn' | 'stop';
  title: string;
  message: string | null;
  person: SnapshotPerson | null;
  warning: string | null;
}

export type ScanInput = { kind: 'qr'; payload: string } | { kind: 'code'; code: string } | { kind: 'manual'; registrationId: string };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TONE: Record<string, Feedback['tone']> = { accepted: 'ok', duplicate: 'warn', review: 'warn', rejected: 'stop' };

export function useScanSession(eventId: string, type: ContextType, contextId: string | null) {
  const contextKey = `${eventId}:${type}:${contextId ?? ''}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const path = type === 'site' ? `/events/${eventId}/scan/site/snapshot` : `/events/${eventId}/scan/${type}/${contextId}/snapshot`;
    try {
      const fresh = await api<Snapshot>(path);
      await saveSnapshot(contextKey, fresh);
      setSnapshot(fresh);
      setFromCache(false);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.status !== 0) {
        setLoadError(err.message);
        return;
      }
      const cached = await loadSnapshot<Snapshot>(contextKey);
      if (cached) {
        setSnapshot(cached);
        setFromCache(true);
      } else {
        setLoadError('No connection, and this phone has not downloaded this list yet. Connect once to start scanning.');
      }
    }
    setEntries(await contextEntries(contextKey));
  }, [contextKey, eventId, type, contextId]);

  useEffect(() => {
    void refresh();
    const off = onSynced(() => void refresh());
    const timer = setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 60_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [refresh]);

  const lookup = useMemo(() => {
    if (!snapshot) return null;
    return {
      people: new Map(snapshot.people.map((p) => [p.id, p])),
      byToken: new Map(snapshot.credentials.map((c) => [c.tokenHash, c])),
      byCode: new Map(snapshot.credentials.map((c) => [c.codeHash, c])),
    };
  }, [snapshot]);

  /** Server state for everyone, plus this phone's scans that haven't synced yet. */
  const states = useMemo(() => {
    const map = new Map<string, PersonState>();
    if (!snapshot || !lookup) return { map, presentNow: 0 };
    for (const p of snapshot.people) if (p.state) map.set(p.id, p.state);
    let presentNow = [...map.values()].filter((s) => s.present).length;
    for (const e of entries) {
      if (e.synced || !e.registrationId) continue;
      const before = map.get(e.registrationId) ?? EMPTY_STATE;
      const person = lookup.people.get(e.registrationId);
      const ev = evaluateScan(
        snapshot.context.rules,
        before,
        {
          direction: e.item.direction,
          deviceTime: e.item.deviceTime,
          credentialRevoked: false,
          registrationWithdrawn: person?.withdrawn ?? false,
          booked: person?.booked ?? false,
        },
        { presentNow },
      );
      if (ev.next.present !== before.present) presentNow += ev.next.present ? 1 : -1;
      map.set(e.registrationId, ev.next);
    }
    return { map, presentNow };
  }, [snapshot, lookup, entries]);

  const record = useCallback(
    async (input: ScanInput, direction: Direction): Promise<Feedback> => {
      if (!snapshot || !lookup || busy.current) throw new Error('not ready');
      busy.current = true;
      try {
        const id = crypto.randomUUID();
        const deviceTime = new Date().toISOString();
        let credential: Snapshot['credentials'][number] | undefined;
        let registrationId: string | null = null;
        const base = { id, contextType: type, contextId, direction, deviceTime };
        let item: OutboxEntry['item'];

        if (input.kind === 'qr') {
          const token = parseCredentialPayload(input.payload);
          if (!token) return { key: id, tone: 'stop', title: 'Not a CampCount card', message: 'This QR code is not a CampCount lanyard.', person: null, warning: null };
          const tokenHash = await sha256Hex(`credential:${token}`);
          credential = lookup.byToken.get(tokenHash);
          item = { ...base, method: 'qr', credentialHash: tokenHash };
        } else if (input.kind === 'code') {
          const code = normaliseShortCode(input.code);
          if (!isShortCode(code)) return { key: id, tone: 'stop', title: 'Check the code', message: 'Codes have 8 letters and numbers, like K7QM-3XRP.', person: null, warning: null };
          const codeHash = await sha256Hex(`code:${eventId}:${code}`);
          credential = lookup.byCode.get(codeHash);
          item = { ...base, method: 'code', codeHash };
        } else {
          registrationId = input.registrationId;
          item = { ...base, method: 'manual', registrationId };
        }
        registrationId ??= credential?.registrationId ?? null;
        const person = registrationId ? (lookup.people.get(registrationId) ?? null) : null;

        let evaluation: Pick<Evaluation, 'outcome' | 'message' | 'warning'>;
        if (!person) {
          evaluation = { outcome: 'rejected', message: 'Not on this event list. If they were just added, refresh and try again.', warning: null };
        } else {
          evaluation = evaluateScan(
            snapshot.context.rules,
            states.map.get(person.id) ?? EMPTY_STATE,
            { direction, deviceTime, credentialRevoked: credential?.revoked ?? false, registrationWithdrawn: person.withdrawn, booked: person.booked },
            { presentNow: states.presentNow },
          );
        }

        // Saved before feedback is shown: nothing is lost if the phone dies now.
        const entry: OutboxEntry = {
          id,
          eventId,
          contextKey,
          item,
          registrationId: person?.id ?? null,
          createdAt: deviceTime,
          synced: 0,
          local: { outcome: evaluation.outcome, message: evaluation.message, warning: evaluation.warning },
        };
        await addToOutbox(entry);
        setEntries((prev) => [...prev, entry]);
        requestSync();

        const accepted = evaluation.outcome === 'accepted';
        return {
          key: id,
          tone: accepted && evaluation.warning ? 'warn' : TONE[evaluation.outcome]!,
          title: accepted ? evaluation.message : evaluation.outcome === 'duplicate' ? 'Already scanned' : evaluation.outcome === 'review' ? 'Check this' : 'Not recorded',
          message: accepted ? null : evaluation.message,
          person,
          warning: evaluation.warning,
        };
      } finally {
        busy.current = false;
      }
    },
    [snapshot, lookup, states, type, contextId, eventId, contextKey],
  );

  return { snapshot, loadError, fromCache, record, states, entries, refresh, deviceIdReady: getDeviceId };
}
