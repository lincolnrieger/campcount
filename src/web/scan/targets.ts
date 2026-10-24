import { useEffect, useState } from 'react';
import { api } from '../api';
import { loadSnapshot, saveSnapshot } from '../offline/db';
import type { Activity } from '../pages/Activities';
import type { Meal } from '../pages/Meals';
import type { EventSummary } from '../types';
import { dayInZone, eventDays, inferDay, timeInZone, timeRange } from '../../shared/time';

/** One thing a volunteer can scan for: the gate, a meal or an activity. */
export interface ScanTarget {
  key: string;
  to: string;
  type: 'site' | 'meal' | 'activity';
  label: string;
  hint: string;
  /** Event-local day (YYYY-MM-DD), or null for "any day". */
  day: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Is this session happening now? (Untimed things never are; no end time means 2 hours.) */
export function isOnNow(t: { startsAt?: string | null; endsAt?: string | null }, now = Date.now()): boolean {
  if (!t.startsAt) return false;
  const start = Date.parse(t.startsAt);
  const end = t.endsAt ? Date.parse(t.endsAt) : start + 2 * 3_600_000;
  return now >= start - 10 * 60_000 && now <= end;
}

// Kept in the device's IndexedDB store, which is wiped on sign-out.
const LAST_KEY = 'ui:last-scan';
const EVENT_KEY = 'ui:scan-event';
const cacheKey = (eventId: string) => `ui:scan-targets:${eventId}`;

export interface LastScan {
  eventId: string;
  to: string;
  label: string;
}

export function rememberLastScan(last: LastScan) {
  void saveSnapshot(LAST_KEY, last).catch(() => undefined);
}

export function useLastScan(): LastScan | null {
  const [last, setLast] = useState<LastScan | null>(null);
  useEffect(() => {
    loadSnapshot<LastScan>(LAST_KEY)
      .then((l) => setLast(l ?? null))
      .catch(() => undefined);
  }, []);
  return last;
}

export function rememberScanEvent(eventId: string) {
  void saveSnapshot(EVENT_KEY, eventId).catch(() => undefined);
}

/** The event last picked on the Scan tab; undefined while loading. */
export function useScanEvent(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    loadSnapshot<string>(EVENT_KEY)
      .then((v) => setId(v ?? null))
      .catch(() => setId(null));
  }, []);
  return id;
}

export function canScan(event: EventSummary): boolean {
  return event.status === 'open' && (['site.scan', 'meal.scan', 'activity.scan'] as const).some((p) => event.permissions.includes(p));
}

export function buildTargets(event: EventSummary, meals: Meal[], activities: Activity[]): ScanTarget[] {
  const can = (p: string) => event.permissions.includes(p as never);
  const days = eventDays(event.startsOn, event.endsOn);
  const tz = event.timezone;
  const base = `/events/${event.id}/scan`;
  const targets: ScanTarget[] = [];
  if (event.features.site && can('site.scan')) {
    targets.push({ key: 'site', to: `${base}/site`, type: 'site', label: 'Gate', hint: 'Arriving and leaving camp', day: null });
  }
  if (event.features.meals && can('meal.scan')) {
    for (const m of meals.filter((m) => m.status === 'active')) {
      targets.push({
        key: `meal:${m.id}`,
        to: `${base}/meal/${m.id}`,
        type: 'meal',
        label: m.name,
        hint: [m.startsAt ? timeInZone(m.startsAt, tz) : null, m.location || null].filter(Boolean).join(', ') || 'Meal',
        day: m.startsAt ? dayInZone(m.startsAt, tz) : inferDay(m.name, days),
        startsAt: m.startsAt,
        endsAt: m.endsAt ?? (m.startsAt ? new Date(Date.parse(m.startsAt) + 90 * 60_000).toISOString() : null),
      });
    }
  }
  if (event.features.activities && can('activity.scan')) {
    for (const a of activities.filter((a) => a.status === 'active')) {
      targets.push({
        key: `activity:${a.id}`,
        to: `${base}/activity/${a.id}`,
        type: 'activity',
        label: a.name,
        hint: [a.startsAt ? timeRange(a.startsAt, a.endsAt, tz) : null, a.location || null].filter(Boolean).join(', ') || 'Runs all camp',
        day: a.startsAt ? dayInZone(a.startsAt, tz) : null,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
      });
    }
  }
  return targets;
}

/**
 * Loads what this person can scan at an event. The list is kept on the phone
 * so the switcher still works with no signal.
 */
export function useScanTargets(event: EventSummary | null): { targets: ScanTarget[] | null; offline: boolean } {
  const [targets, setTargets] = useState<ScanTarget[] | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    let fresh = false;
    setTargets(null);
    loadSnapshot<ScanTarget[]>(cacheKey(event.id))
      .then((cached) => {
        if (!cancelled && !fresh && cached) setTargets(cached);
      })
      .catch(() => undefined);
    const wantMeals = event.features.meals && event.permissions.includes('meal.scan');
    const wantActivities = event.features.activities && event.permissions.includes('activity.scan');
    Promise.all([
      wantMeals ? api<{ meals: Meal[] }>(`/events/${event.id}/meals`) : Promise.resolve({ meals: [] }),
      wantActivities ? api<{ activities: Activity[] }>(`/events/${event.id}/activities`) : Promise.resolve({ activities: [] }),
    ])
      .then(([m, a]) => {
        if (cancelled) return;
        const list = buildTargets(event, m.meals, a.activities);
        fresh = true;
        setTargets(list);
        setOffline(false);
        void saveSnapshot(cacheKey(event.id), list).catch(() => undefined);
      })
      .catch(() => {
        if (cancelled) return;
        setOffline(true);
        setTargets((t) => t ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [event]);
  return { targets, offline };
}

/** The event, from the network or (with no signal) the copy saved on this phone. */
export function useEventSummary(eventId: string | null): EventSummary | null {
  const [event, setEvent] = useState<EventSummary | null>(null);
  useEffect(() => {
    if (!eventId) return;
    const key = `ui:event:${eventId}`;
    let fresh = false;
    loadSnapshot<EventSummary>(key)
      .then((cached) => {
        if (!fresh && cached) setEvent(cached);
      })
      .catch(() => undefined);
    api<{ event: EventSummary }>(`/events/${eventId}`)
      .then(({ event: e }) => {
        fresh = true;
        setEvent(e);
        void saveSnapshot(key, e).catch(() => undefined);
      })
      .catch(() => undefined);
  }, [eventId]);
  return event;
}
