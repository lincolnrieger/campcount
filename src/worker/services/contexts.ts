import type { ContextRules, ContextType, TimelineScan } from '../../shared/scanRules';
import { replay } from '../../shared/scanRules';
import { notFound } from '../lib/errors';
import type { Principal } from './principal';
import { can } from './principal';

export interface ScanContext {
  type: ContextType;
  id: string | null;
  name: string;
  rules: ContextRules;
}

interface ActivityRow {
  id: string;
  name: string;
  capacity: number | null;
  capacity_policy: 'warn' | 'block';
  track_sign_out: number;
  allow_repeat: number;
  booking_required: number;
  status: string;
}

/** Load a scanning context belonging to the event, or 404. */
export async function loadContext(db: D1Database, eventId: string, type: ContextType, id: string | null): Promise<ScanContext> {
  if (type === 'site') {
    if (id !== null) throw notFound();
    return { type, id: null, name: 'On site', rules: { type: 'site' } };
  }
  if (!id) throw notFound();
  if (type === 'meal') {
    const meal = await db
      .prepare(`SELECT id, name FROM meal_services WHERE id = ? AND event_id = ? AND status = 'active'`)
      .bind(id, eventId)
      .first<{ id: string; name: string }>();
    if (!meal) throw notFound();
    return { type, id, name: meal.name, rules: { type: 'meal' } };
  }
  const a = await db
    .prepare(`SELECT * FROM activities WHERE id = ? AND event_id = ? AND status = 'active'`)
    .bind(id, eventId)
    .first<ActivityRow>();
  if (!a) throw notFound();
  return {
    type,
    id,
    name: a.name,
    rules: {
      type: 'activity',
      capacity: a.capacity,
      capacityPolicy: a.capacity_policy,
      trackSignOut: a.track_sign_out === 1,
      allowRepeat: a.allow_repeat === 1,
      bookingRequired: a.booking_required === 1,
    },
  };
}

export function canScan(principal: Principal, eventId: string, type: ContextType, id: string | null): boolean {
  switch (type) {
    case 'activity':
      return can(principal, 'activity.scan', { eventId, activityId: id ?? undefined });
    case 'meal':
      if (principal.kind === 'station' && principal.contextId !== id) return false;
      return can(principal, 'meal.scan', { eventId });
    case 'site':
      return can(principal, 'site.scan', { eventId });
  }
}

interface TimelineRow {
  id: string;
  registration_id: string;
  direction: 'in' | 'out';
  device_time: string;
  revoked: number;
  withdrawn: number;
  booked: number;
}

/**
 * Every scan in a context that counts: excludes voided scans, scans that a
 * correction superseded, and scans of unknown cards.
 */
export async function loadTimeline(db: D1Database, eventId: string, ctx: ScanContext): Promise<TimelineScan[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.registration_id, s.direction, s.device_time,
              CASE WHEN c.revoked_at IS NOT NULL AND c.revoked_at <= s.device_time THEN 1 ELSE 0 END AS revoked,
              CASE WHEN r.status = 'withdrawn' THEN 1 ELSE 0 END AS withdrawn,
              CASE WHEN ?3 = 'activity' AND EXISTS (SELECT 1 FROM activity_bookings b WHERE b.activity_id = s.context_id AND b.registration_id = s.registration_id) THEN 1 ELSE 0 END AS booked
         FROM scans s
         JOIN registrations r ON r.id = s.registration_id
         LEFT JOIN credentials c ON c.id = s.credential_id
        WHERE s.event_id = ?1 AND s.context_type = ?3 AND s.context_id IS ?2
          AND s.outcome <> 'void'
          AND NOT EXISTS (SELECT 1 FROM scans v WHERE v.supersedes_id = s.id)`,
    )
    .bind(eventId, ctx.id, ctx.type)
    .all<TimelineRow>();
  return results.map((r) => ({
    id: r.id,
    registrationId: r.registration_id,
    direction: r.direction,
    deviceTime: r.device_time,
    credentialRevoked: r.revoked === 1,
    registrationWithdrawn: r.withdrawn === 1,
    booked: r.booked === 1,
  }));
}

export async function contextState(db: D1Database, eventId: string, ctx: ScanContext) {
  const timeline = await loadTimeline(db, eventId, ctx);
  return { timeline, ...replay(ctx.rules, timeline) };
}
