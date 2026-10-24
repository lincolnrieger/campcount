import type { ContextRules, Evaluation, TimelineScan } from '../../shared/scanRules';
import { replay } from '../../shared/scanRules';
import { displayName } from '../../shared/names';

/**
 * Event-wide reporting model. Everything is derived from the scan records by
 * replaying them with the shared rules; there are no stored counters.
 */

export interface ReportContext {
  key: string;
  type: 'activity' | 'meal' | 'site';
  id: string | null;
  name: string;
  status: string;
  rules: ContextRules;
  capacity: number | null;
}

export interface ReportPerson {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  memberNumber: string;
  groupName: string;
  section: string;
  kind: string;
  status: string;
}

export interface ScanRecord {
  id: string;
  contextKey: string;
  registrationId: string | null;
  direction: 'in' | 'out';
  method: string;
  deviceTime: string;
  serverTime: string;
  deviceId: string;
  storedOutcome: string;
  voided: boolean;
  credentialRevoked: boolean;
  booked: boolean;
  correctionReason: string;
}

export interface EventModel {
  contexts: ReportContext[];
  people: Map<string, ReportPerson>;
  scans: ScanRecord[];
  replays: Map<string, { outcomes: Map<string, Evaluation>; states: Map<string, { present: boolean; visits: number; lastAcceptedAt: string | null }>; presentNow: number }>;
}

export async function loadEventModel(db: D1Database, eventId: string, includeSite: boolean): Promise<EventModel> {
  const [activities, meals, people, scans] = await Promise.all([
    db.prepare(`SELECT * FROM activities WHERE event_id = ? ORDER BY starts_at IS NULL, starts_at, name COLLATE NOCASE`).bind(eventId).all<Record<string, any>>(),
    db.prepare(`SELECT * FROM meal_services WHERE event_id = ? ORDER BY starts_at IS NULL, starts_at, created_at`).bind(eventId).all<Record<string, any>>(),
    db
      .prepare(
        `SELECT r.id, p.first_name, p.preferred_name, p.last_name, p.member_number, r.group_name, r.section, r.kind, r.status
           FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ?`,
      )
      .bind(eventId)
      .all<Record<string, string>>(),
    db
      .prepare(
        `SELECT s.id, s.context_type, s.context_id, s.registration_id, s.direction, s.method, s.device_time, s.server_time,
                s.device_id, s.outcome, s.correction_reason,
                EXISTS (SELECT 1 FROM scans v WHERE v.supersedes_id = s.id) AS voided,
                CASE WHEN c.revoked_at IS NOT NULL AND c.revoked_at <= s.device_time THEN 1 ELSE 0 END AS revoked,
                CASE WHEN s.context_type = 'activity' AND EXISTS (SELECT 1 FROM activity_bookings b WHERE b.activity_id = s.context_id AND b.registration_id = s.registration_id) THEN 1 ELSE 0 END AS booked
           FROM scans s LEFT JOIN credentials c ON c.id = s.credential_id
          WHERE s.event_id = ? AND s.outcome <> 'void'`,
      )
      .bind(eventId)
      .all<Record<string, any>>(),
  ]);

  const contexts: ReportContext[] = [
    ...(includeSite ? [{ key: 'site:', type: 'site' as const, id: null, name: 'On site', status: 'active', rules: { type: 'site' as const }, capacity: null }] : []),
    ...meals.results.map((m) => ({ key: `meal:${m.id}`, type: 'meal' as const, id: m.id, name: m.name, status: m.status, rules: { type: 'meal' as const }, capacity: null })),
    ...activities.results.map((a) => ({
      key: `activity:${a.id}`,
      type: 'activity' as const,
      id: a.id,
      name: a.name,
      status: a.status,
      capacity: a.capacity,
      rules: {
        type: 'activity' as const,
        capacity: a.capacity,
        capacityPolicy: a.capacity_policy,
        trackSignOut: a.track_sign_out === 1,
        allowRepeat: a.allow_repeat === 1,
        bookingRequired: a.booking_required === 1,
      },
    })),
  ];

  const peopleMap = new Map<string, ReportPerson>(
    people.results.map((p) => [
      p.id!,
      {
        id: p.id!,
        name: displayName(p.first_name!, p.preferred_name!, p.last_name!),
        firstName: p.preferred_name || p.first_name!,
        lastName: p.last_name!,
        memberNumber: p.member_number!,
        groupName: p.group_name!,
        section: p.section!,
        kind: p.kind!,
        status: p.status!,
      },
    ]),
  );

  const records: ScanRecord[] = scans.results.map((s) => ({
    id: s.id,
    contextKey: `${s.context_type}:${s.context_id ?? ''}`,
    registrationId: s.registration_id,
    direction: s.direction,
    method: s.method,
    deviceTime: s.device_time,
    serverTime: s.server_time,
    deviceId: s.device_id,
    storedOutcome: s.outcome,
    voided: s.voided === 1,
    credentialRevoked: s.revoked === 1,
    booked: s.booked === 1,
    correctionReason: s.correction_reason,
  }));

  const replays: EventModel['replays'] = new Map();
  for (const ctx of contexts) {
    const timeline: TimelineScan[] = records
      .filter((r) => r.contextKey === ctx.key && r.registrationId && !r.voided)
      .map((r) => ({
        id: r.id,
        registrationId: r.registrationId!,
        direction: r.direction,
        deviceTime: r.deviceTime,
        credentialRevoked: r.credentialRevoked,
        registrationWithdrawn: peopleMap.get(r.registrationId!)?.status === 'withdrawn',
        booked: r.booked,
      }));
    replays.set(ctx.key, replay(ctx.rules, timeline));
  }
  return { contexts, people: peopleMap, scans: records, replays };
}

export function summarise(model: EventModel) {
  const active = [...model.people.values()].filter((p) => p.status === 'active');
  const contexts = model.contexts.map((ctx) => {
    const r = model.replays.get(ctx.key)!;
    const states = [...r.states.values()];
    const accepted = [...r.outcomes.values()].filter((o) => o.outcome === 'accepted');
    const outcomes = [...r.outcomes.values()];
    return {
      key: ctx.key,
      type: ctx.type,
      id: ctx.id,
      name: ctx.name,
      status: ctx.status,
      capacity: ctx.capacity,
      trackSignOut: ctx.rules.type === 'activity' ? ctx.rules.trackSignOut : ctx.type === 'site',
      presentNow: r.presentNow,
      people: states.filter((s) => s.visits > 0).length,
      acceptedScans: accepted.length,
      duplicates: outcomes.filter((o) => o.outcome === 'duplicate').length,
      needsReview: outcomes.filter((o) => o.outcome === 'review').length,
      expected: ctx.type === 'meal' ? active.length : null,
    };
  });
  return {
    roster: {
      active: active.length,
      youth: active.filter((p) => p.kind === 'youth').length,
      adults: active.filter((p) => p.kind === 'adult').length,
      withdrawn: model.people.size - active.length,
    },
    contexts,
  };
}

export interface OpenItem {
  kind: 'still_present' | 'review' | 'unknown_card';
  contextKey: string;
  contextName: string;
  registrationId: string | null;
  name: string;
  detail: string;
  at: string | null;
  scanId: string | null;
}

/** Records that need a human decision before the event is finalised. */
export function openItems(model: EventModel): OpenItem[] {
  const items: OpenItem[] = [];
  for (const ctx of model.contexts) {
    const r = model.replays.get(ctx.key)!;
    const tracksPresence = ctx.type === 'site' || (ctx.rules.type === 'activity' && ctx.rules.trackSignOut);
    if (tracksPresence) {
      for (const [registrationId, state] of r.states) {
        if (!state.present) continue;
        items.push({
          kind: 'still_present',
          contextKey: ctx.key,
          contextName: ctx.name,
          registrationId,
          name: model.people.get(registrationId)?.name ?? 'Unknown',
          detail: ctx.type === 'site' ? 'Still recorded as on site' : 'Still signed in',
          at: state.lastAcceptedAt,
          scanId: null,
        });
      }
    }
    for (const [scanId, evaluation] of r.outcomes) {
      if (evaluation.outcome !== 'review') continue;
      const scan = model.scans.find((s) => s.id === scanId)!;
      items.push({
        kind: 'review',
        contextKey: ctx.key,
        contextName: ctx.name,
        registrationId: scan.registrationId,
        name: model.people.get(scan.registrationId!)?.name ?? 'Unknown',
        detail: evaluation.message,
        at: scan.deviceTime,
        scanId,
      });
    }
  }
  for (const scan of model.scans) {
    if (scan.registrationId || scan.voided || scan.method === 'correction') continue;
    const ctx = model.contexts.find((c) => c.key === scan.contextKey);
    items.push({
      kind: 'unknown_card',
      contextKey: scan.contextKey,
      contextName: ctx?.name ?? '',
      registrationId: null,
      name: 'Unknown card',
      detail: 'A card that is not on this event was scanned.',
      at: scan.deviceTime,
      scanId: scan.id,
    });
  }
  return items.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

export function devices(model: EventModel) {
  const byDevice = new Map<string, { deviceId: string; lastUpload: string; scans: number }>();
  for (const s of model.scans) {
    if (s.method === 'correction') continue;
    const d = byDevice.get(s.deviceId) ?? { deviceId: s.deviceId, lastUpload: s.serverTime, scans: 0 };
    d.scans++;
    if (s.serverTime > d.lastUpload) d.lastUpload = s.serverTime;
    byDevice.set(s.deviceId, d);
  }
  return [...byDevice.values()].sort((a, b) => b.lastUpload.localeCompare(a.lastUpload));
}

// ---------------------------------------------------------------- CSV

/** Neutralise spreadsheet formula injection and quote every cell. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(preamble: string[], header: string[], rows: unknown[][]): string {
  const lines = [...preamble.map((p) => csvCell(p)), '', header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function localTime(iso: string | null, timezone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export interface Whereabouts {
  /** 'on' = on site now, 'off' = arrived then left, 'never' = not arrived yet; null when the event doesn't track the gate. */
  site: 'on' | 'off' | 'never' | null;
  siteSince: string | null;
  /** Activities they are signed in to right now (only activities that track sign-out). */
  activities: { key: string; name: string; since: string | null }[];
  lastSeen: { contextName: string; type: 'activity' | 'meal' | 'site'; direction: 'in' | 'out'; at: string } | null;
}

/** Where each person is, according to the scan records. */
export function whereabouts(model: EventModel): Map<string, Whereabouts> {
  const site = model.contexts.find((c) => c.type === 'site');
  const out = new Map<string, Whereabouts>();
  for (const id of model.people.keys()) {
    let siteState: Whereabouts['site'] = null;
    let siteSince: string | null = null;
    if (site) {
      const s = model.replays.get(site.key)!.states.get(id);
      siteState = !s || s.visits === 0 ? 'never' : s.present ? 'on' : 'off';
      siteSince = s?.lastAcceptedAt ?? null;
    }
    out.set(id, { site: siteState, siteSince, activities: [], lastSeen: null });
  }
  for (const ctx of model.contexts) {
    if (ctx.rules.type !== 'activity' || !ctx.rules.trackSignOut) continue;
    for (const [id, s] of model.replays.get(ctx.key)!.states) {
      if (s.present) out.get(id)?.activities.push({ key: ctx.key, name: ctx.name, since: s.lastAcceptedAt });
    }
  }
  const byKey = new Map(model.contexts.map((c) => [c.key, c]));
  for (const scan of model.scans) {
    if (!scan.registrationId || scan.voided) continue;
    if (model.replays.get(scan.contextKey)?.outcomes.get(scan.id)?.outcome !== 'accepted') continue;
    const w = out.get(scan.registrationId);
    const ctx = byKey.get(scan.contextKey);
    if (!w || !ctx) continue;
    if (!w.lastSeen || scan.deviceTime > w.lastSeen.at) {
      w.lastSeen = { contextName: ctx.name, type: ctx.type, direction: scan.direction, at: scan.deviceTime };
    }
  }
  return out;
}
