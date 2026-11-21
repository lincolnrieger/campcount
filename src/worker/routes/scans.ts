import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { normaliseShortCode } from '../../shared/credentials';
import type { ContextType } from '../../shared/scanRules';
import { replay } from '../../shared/scanRules';
import type { ScanUploadItem } from '../../shared/schemas';
import { scanUploadSchema, voidScanSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission } from '../context';
import { ApiError, conflict, forbidden, notFound } from '../lib/errors';
import { addMinutes, nowIso } from '../lib/time';
import { sha256Hex } from '../lib/crypto';
import { limitAuthNetwork } from '../lib/rateLimit';
import { auditStatement } from '../services/audit';
import { forgetDashboard } from '../services/reports';
import type { ScanContext } from '../services/contexts';
import { canScan, loadContext, loadTimeline } from '../services/contexts';
import type { Principal } from '../services/principal';
import { activityAccess, can } from '../services/principal';
import { SESSION_COOKIE, createSession } from '../services/sessions';
import { getEventRow } from './events';
import { displayName } from '../../shared/names';

export const scanRoutes = new Hono<AppEnv>();

const contextParams = z.object({
  type: z.enum(['activity', 'meal', 'site']),
  id: z.uuid().optional(),
});

async function authorisedContext(c: AppContext, eventId: string, type: ContextType, id: string | null): Promise<{ principal: Principal; ctx: ScanContext }> {
  const principal = requirePermission(c, 'event.view', { eventId });
  if (!canScan(principal, eventId, type, id)) throw forbidden();
  const ctx = await loadContext(c.env.DB, eventId, type, id);
  return { principal, ctx };
}

function dietaryAlert(entries: { category: string; item: string; severity: string }[]): string | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => Number(b.category === 'allergy') - Number(a.category === 'allergy'));
  return sorted
    .map((e) => (e.category === 'allergy' ? `Allergy: ${e.item}${e.severity === 'anaphylactic' ? ' (anaphylactic)' : ''}` : e.item))
    .join('; ');
}

export function codeHash(eventId: string, code: string): Promise<string> {
  return sha256Hex(`code:${eventId}:${normaliseShortCode(code)}`);
}

/**
 * Everything a scanning device needs to work offline for one context: who is
 * on the roster (display fields only), credential hashes, and current state.
 * Raw tokens are never included. Typed codes are membership numbers, so their
 * hashes only slow down, not stop, someone holding the device: the numbers
 * themselves go only to people who can see the roster.
 */
async function snapshot(c: AppContext) {
  const eventId = c.req.param('eventId')!;
  const params = contextParams.safeParse({ type: c.req.param('type') ?? 'site', id: c.req.param('id') });
  if (!params.success) throw notFound();
  const { principal, ctx } = await authorisedContext(c, eventId, params.data.type, params.data.id ?? null);
  const event = (await getEventRow(c.env.DB, eventId))!;
  if (event.status !== 'open') throw conflict('This event is not open for scanning.');

  const showPhoto = event.feature_photo === 1 && can(principal, 'photo.view_status', { eventId });
  const showDietary = ctx.type === 'meal' && event.feature_dietary === 1 && can(principal, 'dietary.view_alert', { eventId });
  const showNumbers = can(principal, 'roster.view', { eventId });

  const [people, credentials, dietary, bookings, timeline] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name, r.photo_consent, r.status,
              r.car_rego_asked_at
         FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ?`,
    )
      .bind(eventId)
      .all<Record<string, string>>(),
    c.env.DB.prepare(`SELECT registration_id, token_hash, short_code, status FROM credentials WHERE event_id = ?`)
      .bind(eventId)
      .all<{ registration_id: string; token_hash: string; short_code: string; status: string }>(),
    showDietary
      ? c.env.DB.prepare(`SELECT registration_id, category, item, severity FROM dietary_entries WHERE event_id = ?`)
          .bind(eventId)
          .all<{ registration_id: string; category: string; item: string; severity: string }>()
      : Promise.resolve({ results: [] as { registration_id: string; category: string; item: string; severity: string }[] }),
    ctx.type === 'activity'
      ? c.env.DB.prepare(`SELECT registration_id FROM activity_bookings WHERE activity_id = ?`).bind(ctx.id).all<{ registration_id: string }>()
      : Promise.resolve({ results: [] as { registration_id: string }[] }),
    loadTimeline(c.env.DB, eventId, ctx),
  ]);

  const dietaryBy = new Map<string, { category: string; item: string; severity: string }[]>();
  for (const d of dietary.results) dietaryBy.set(d.registration_id, [...(dietaryBy.get(d.registration_id) ?? []), d]);
  const booked = new Set(bookings.results.map((b) => b.registration_id));
  const { states } = replay(ctx.rules, timeline);

  return c.json({
    event: { id: event.id, name: event.name, timezone: event.timezone },
    context: { type: ctx.type, id: ctx.id, name: ctx.name, rules: ctx.rules },
    generatedAt: nowIso(),
    people: people.results.map((p) => {
      const state = states.get(p.id!);
      return {
        id: p.id,
        name: displayName(p.first_name!, p.preferred_name!, p.last_name!),
        // Full name for staff search on the scanner (lanyards only show the initial).
        fullName: `${p.preferred_name || p.first_name} ${p.last_name}`,
        ...(showNumbers ? { memberNumber: p.member_number } : {}),
        group: p.group_name,
        section: p.section,
        kind: p.kind,
        withdrawn: p.status === 'withdrawn',
        booked: booked.has(p.id!),
        // Leaders are asked for their car's rego the first time they're scanned.
        ...(p.kind === 'adult' && !p.car_rego_asked_at && p.status === 'active' ? { askRego: true } : {}),
        ...(showPhoto && p.photo_consent !== 'yes' ? { noPhotos: true } : {}),
        ...(showDietary ? { dietaryAlert: dietaryAlert(dietaryBy.get(p.id!) ?? []) } : {}),
        state: state ? { present: state.present, visits: state.visits, lastAcceptedAt: state.lastAcceptedAt } : null,
      };
    }),
    credentials: await Promise.all(
      credentials.results.map(async (cr) => ({
        registrationId: cr.registration_id,
        tokenHash: cr.token_hash,
        codeHash: await codeHash(eventId, cr.short_code),
        revoked: cr.status === 'revoked',
      })),
    ),
  });
}
scanRoutes.get('/scan/site/snapshot', snapshot);
scanRoutes.get('/scan/:type/:id/snapshot', snapshot);

interface ResolvedScan {
  item: ScanUploadItem;
  registrationId: string | null;
  credentialId: string | null;
  rejectReason: string | null;
}

scanRoutes.post('/scans', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'event.view', { eventId });
  const input = await parseBody(c, scanUploadSchema);
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (event.status !== 'open' && event.status !== 'completed') throw conflict('This event is not accepting scans.');

  // Authorise every context in the batch before writing anything.
  const contexts = new Map<string, ScanContext>();
  for (const item of input.scans) {
    const key = `${item.contextType}:${item.contextId ?? ''}`;
    if (contexts.has(key)) continue;
    if (!canScan(principal, eventId, item.contextType, item.contextId)) throw forbidden();
    contexts.set(key, await loadContext(c.env.DB, eventId, item.contextType, item.contextId));
  }

  const now = nowIso();
  const lateLimit = addMinutes(now, 10);
  const resolved: ResolvedScan[] = [];
  let codeIndex: Map<string, { id: string; registration_id: string }> | null = null;
  // Look every scanned card up in a few queries, not one query per scan: a
  // phone back in signal can upload 200 scans at once.
  const byTokenHash = await lookupIn<{ id: string; registration_id: string; token_hash: string }>(
    c.env.DB,
    `SELECT id, registration_id, token_hash FROM credentials WHERE event_id = ? AND token_hash IN`,
    eventId,
    input.scans.map((s) => s.credentialHash).filter((h): h is string => !!h),
  ).then((rows) => new Map(rows.map((r) => [r.token_hash, r])));
  const manualIds = await lookupIn<{ id: string }>(
    c.env.DB,
    `SELECT id FROM registrations WHERE event_id = ? AND id IN`,
    eventId,
    input.scans.filter((s) => s.method === 'manual' && s.registrationId).map((s) => s.registrationId!),
  ).then((rows) => new Set(rows.map((r) => r.id)));
  for (const item of input.scans) {
    let cred: { id: string; registration_id: string } | null = null;
    if (item.credentialHash) {
      cred = byTokenHash.get(item.credentialHash) ?? null;
    } else if (item.codeHash) {
      // Typed codes are matched by hashing this event's codes (once per request).
      if (!codeIndex) {
        const { results } = await c.env.DB.prepare(`SELECT id, registration_id, short_code FROM credentials WHERE event_id = ?`)
          .bind(eventId)
          .all<{ id: string; registration_id: string; short_code: string }>();
        codeIndex = new Map(await Promise.all(results.map(async (r) => [await codeHash(eventId, r.short_code), r] as const)));
      }
      cred = codeIndex.get(item.codeHash) ?? null;
    }
    let registrationId = cred?.registration_id ?? null;
    if (item.method === 'manual' && item.registrationId) {
      registrationId = manualIds.has(item.registrationId) ? item.registrationId : null;
    }
    resolved.push({
      item,
      registrationId,
      credentialId: cred?.id ?? null,
      rejectReason: registrationId ? null : 'Not a card for this event.',
    });
  }

  const actorUser = principal.kind === 'user' ? principal.userId : null;
  const actorStation = principal.kind === 'station' ? principal.stationId : null;
  const statements = resolved.map((r) =>
    c.env.DB.prepare(
      `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, credential_id, direction, method,
          device_time, server_time, device_id, actor_user_id, actor_station_id, outcome, outcome_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    ).bind(
      r.item.id,
      eventId,
      r.item.contextType,
      r.item.contextId,
      r.registrationId,
      r.credentialId,
      r.item.direction,
      r.item.method,
      r.item.deviceTime,
      now,
      input.deviceId,
      actorUser,
      actorStation,
      r.registrationId ? (r.item.deviceTime > lateLimit ? 'review' : 'accepted') : 'rejected',
      r.rejectReason ?? (r.item.deviceTime > lateLimit ? 'Device clock is ahead of the server.' : ''),
    ),
  );
  await c.env.DB.batch(statements);
  forgetDashboard(eventId);

  // Moving between activities: someone scanned into an activity is signed
  // out of any other activity (that tracks sign-out) where they're still
  // recorded as here, so "Here now" stays right without a second scan.
  const movedFrom = await autoSignOut(c, eventId, resolved, actorUser, actorStation, now);

  // Authoritative outcomes come from replaying each affected context.
  const results: { id: string; outcome: string; message: string; warning: string | null; registrationId: string | null }[] = [];
  const replays = new Map<string, ReturnType<typeof replay>>();
  for (const [key, ctx] of contexts) replays.set(key, replay(ctx.rules, await loadTimeline(c.env.DB, eventId, ctx)));
  for (const r of resolved) {
    if (!r.registrationId) {
      results.push({ id: r.item.id, outcome: 'rejected', message: r.rejectReason!, warning: null, registrationId: null });
      continue;
    }
    const evaluation = replays.get(`${r.item.contextType}:${r.item.contextId ?? ''}`)!.outcomes.get(r.item.id);
    const moved = movedFrom.get(r.item.id);
    const warning = [evaluation?.warning, moved ? `Signed out of ${moved} automatically.` : null].filter(Boolean).join(' ') || null;
    results.push({
      id: r.item.id,
      outcome: evaluation?.outcome ?? 'review',
      message: evaluation?.message ?? 'Recorded for review.',
      warning,
      registrationId: r.registrationId,
    });
  }
  return c.json({ results, serverTime: now });
});

/**
 * For each scan into an activity, sign the person out of other activities
 * (with sign-out tracking) where their latest scan before this one is still
 * a sign-in. Each sign-out is a new scan, marked as automatic; nothing is
 * changed or deleted. Returns scan id → the activity names they left.
 */
async function autoSignOut(
  c: AppContext,
  eventId: string,
  resolved: ResolvedScan[],
  actorUser: string | null,
  actorStation: string | null,
  now: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ins = resolved.filter((r) => r.registrationId && r.item.contextType === 'activity' && r.item.direction === 'in' && r.item.contextId);
  if (ins.length === 0) return out;
  const statements: D1PreparedStatement[] = [];
  for (const r of ins) {
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.name FROM activities a
        WHERE a.event_id = ?1 AND a.track_sign_out = 1 AND a.id <> ?2
          AND (SELECT s.direction FROM scans s
                WHERE s.event_id = ?1 AND s.context_type = 'activity' AND s.context_id = a.id AND s.registration_id = ?3
                  AND s.outcome = 'accepted' AND s.device_time <= ?4
                  AND NOT EXISTS (SELECT 1 FROM scans v WHERE v.supersedes_id = s.id)
                ORDER BY s.device_time DESC, s.id DESC LIMIT 1) = 'in'`,
    )
      .bind(eventId, r.item.contextId, r.registrationId, r.item.deviceTime)
      .all<{ id: string; name: string }>();
    if (results.length === 0) continue;
    out.set(r.item.id, results.map((a) => a.name).join(', '));
    for (const a of results) {
      const reason = 'Signed out automatically: scanned in at another activity.';
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time,
              device_id, actor_user_id, actor_station_id, outcome, outcome_reason, correction_reason)
           VALUES (?, ?, 'activity', ?, ?, 'out', 'correction', ?, ?, 'server', ?, ?, 'accepted', ?, ?)`,
        ).bind(crypto.randomUUID(), eventId, a.id, r.registrationId, r.item.deviceTime, now, actorUser, actorStation, reason, reason),
      );
    }
  }
  if (statements.length) await c.env.DB.batch(statements);
  return out;
}

/** Correct a mistaken scan. The original stays on record; a correction supersedes it. */
scanRoutes.post('/scans/:scanId/void', async (c) => {
  const eventId = c.req.param('eventId')!;
  const scanId = z.uuid().safeParse(c.req.param('scanId'));
  const principal = requirePermission(c, 'attendance.correct', { eventId });
  if (!scanId.success) throw notFound();
  const { reason } = await parseBody(c, voidScanSchema);
  const original = await c.env.DB.prepare(
    `SELECT id, context_type, context_id, registration_id, direction FROM scans WHERE id = ? AND event_id = ? AND outcome <> 'void'`,
  )
    .bind(scanId.data, eventId)
    .first<{ id: string; context_type: string; context_id: string | null; registration_id: string | null; direction: string }>();
  if (!original) throw notFound();
  const already = await c.env.DB.prepare(`SELECT 1 FROM scans WHERE supersedes_id = ?`).bind(original.id).first();
  if (already) throw conflict('This scan has already been corrected.');
  const now = nowIso();
  const id = crypto.randomUUID();
  const userId = principal.kind === 'user' ? principal.userId : null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time,
          device_id, actor_user_id, outcome, supersedes_id, correction_reason)
       VALUES (?, ?, ?, ?, ?, ?, 'correction', ?, ?, 'server', ?, 'void', ?, ?)`,
    ).bind(id, eventId, original.context_type, original.context_id, original.registration_id, original.direction, now, now, userId, original.id, reason),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: userId! },
      action: 'scan.void',
      eventId,
      targetType: 'scan',
      targetId: original.id,
    }),
  ]);
  forgetDashboard(eventId);
  return c.json({ id });
});

/**
 * "Remove" on the scanner's Eaten / Checked in list: undo someone's scans at
 * this meal or activity, so they're back in "Not yet". Scans are never changed
 * or deleted: each gets a void correction, and the audit log records who did
 * it. Anyone who can scan here can do it, including a scanning station.
 */
scanRoutes.post('/scan/:type/:id/people/:registrationId/remove', async (c) => {
  const eventId = c.req.param('eventId')!;
  const params = contextParams.safeParse({ type: c.req.param('type'), id: c.req.param('id') });
  const registrationId = z.uuid().safeParse(c.req.param('registrationId'));
  if (!params.success || !params.data.id || params.data.type === 'site' || !registrationId.success) throw notFound();
  const { principal, ctx } = await authorisedContext(c, eventId, params.data.type, params.data.id);
  const event = (await getEventRow(c.env.DB, eventId))!;
  if (event.status !== 'open') throw conflict('Scans can only be changed while the event is open.');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.direction FROM scans s
      WHERE s.event_id = ? AND s.context_type = ? AND s.context_id = ? AND s.registration_id = ?
        AND s.outcome IN ('accepted', 'duplicate', 'review')
        AND NOT EXISTS (SELECT 1 FROM scans c WHERE c.supersedes_id = s.id)`,
  )
    .bind(eventId, ctx.type, ctx.id, registrationId.data)
    .all<{ id: string; direction: string }>();
  if (results.length === 0) return c.json({ undone: 0 });
  const now = nowIso();
  const actorUser = principal.kind === 'user' ? principal.userId : null;
  const actorStation = principal.kind === 'station' ? principal.stationId : null;
  const reason = ctx.type === 'meal' ? 'Removed from Eaten on the scanner' : 'Removed from Checked in on the scanner';
  await c.env.DB.batch([
    ...results.map((s) =>
      c.env.DB.prepare(
        `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time,
            device_id, actor_user_id, actor_station_id, outcome, supersedes_id, correction_reason)
         VALUES (?, ?, ?, ?, ?, ?, 'correction', ?, ?, 'server', ?, ?, 'void', ?, ?)`,
      ).bind(crypto.randomUUID(), eventId, ctx.type, ctx.id, registrationId.data, s.direction, now, now, actorUser, actorStation, s.id, reason),
    ),
    auditStatement(c.env.DB, {
      actor: actorStation ? { type: 'station', id: actorStation } : { type: 'user', id: actorUser! },
      action: 'attendance.reset',
      eventId,
      targetType: ctx.type,
      targetId: params.data.id,
      detail: { scans: results.length, registrationId: registrationId.data, via: 'scanner' },
    }),
  ]);
  forgetDashboard(eventId);
  return c.json({ undone: results.length });
});

/** Recent scans in a context, for the scanner's history and director corrections. */
async function recent(c: AppContext) {
  const eventId = c.req.param('eventId')!;
  const params = contextParams.safeParse({ type: c.req.param('type') ?? 'site', id: c.req.param('id') });
  if (!params.success) throw notFound();
  const { ctx } = await authorisedContext(c, eventId, params.data.type, params.data.id ?? null);
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.registration_id, s.direction, s.method, s.device_time, s.outcome, s.outcome_reason,
            p.first_name, p.preferred_name, p.last_name,
            EXISTS (SELECT 1 FROM scans v WHERE v.supersedes_id = s.id) AS voided
       FROM scans s LEFT JOIN registrations r ON r.id = s.registration_id LEFT JOIN people p ON p.id = r.person_id
      WHERE s.event_id = ? AND s.context_type = ? AND s.context_id IS ? AND s.outcome <> 'void'
      ORDER BY s.device_time DESC LIMIT 50`,
  )
    .bind(eventId, ctx.type, ctx.id)
    .all<Record<string, string | number | null>>();
  return c.json({
    scans: results.map((s) => ({
      id: s.id,
      registrationId: s.registration_id,
      name: s.first_name ? displayName(String(s.first_name), String(s.preferred_name ?? ''), String(s.last_name ?? '')) : 'Unknown card',
      direction: s.direction,
      method: s.method,
      deviceTime: s.device_time,
      voided: s.voided === 1,
    })),
  });
}
scanRoutes.get('/scan/site/recent', recent);
scanRoutes.get('/scan/:type/:id/recent', recent);

/** Run `sql (?, ?, …)` for distinct values in chunks (D1 allows at most 100 bound values per query). */
async function lookupIn<T>(db: D1Database, sql: string, eventId: string, values: string[]): Promise<T[]> {
  const distinct = [...new Set(values)];
  const out: T[] = [];
  for (let i = 0; i < distinct.length; i += 90) {
    const chunk = distinct.slice(i, i + 90);
    const { results } = await db
      .prepare(`${sql} (${chunk.map(() => '?').join(', ')})`)
      .bind(eventId, ...chunk)
      .all<T>();
    out.push(...results);
  }
  return out;
}

// ---------------------------------------------------------------- station pairing (no account needed)

export const pairingRoutes = new Hono<AppEnv>();

pairingRoutes.post('/pair', async (c) => {
  const { code } = await parseBody(c, z.strictObject({ code: z.string().trim().min(8).max(12) }));
  await limitAuthNetwork(c, 'pair');
  const now = nowIso();
  const station = await c.env.DB.prepare(
    `SELECT s.id, s.expires_at, s.event_id FROM stations s JOIN events e ON e.id = s.event_id
      WHERE s.pairing_code_hash = ? AND s.pairing_expires_at > ? AND s.revoked_at IS NULL AND s.paired_at IS NULL AND e.status = 'open'`,
  )
    .bind(await sha256Hex(`pair:${normaliseShortCode(code)}`), now)
    .first<{ id: string; expires_at: string; event_id: string }>();
  if (!station) throw new ApiError(400, 'invalid_code', 'That pairing code is not valid or has expired. Ask a director for a new one.');

  // Single use: clear the code atomically.
  const claimed = await c.env.DB.prepare(
    `UPDATE stations SET paired_at = ?, pairing_code_hash = NULL WHERE id = ? AND paired_at IS NULL`,
  )
    .bind(now, station.id)
    .run();
  if (claimed.meta.changes !== 1) throw new ApiError(400, 'invalid_code', 'That pairing code has already been used.');

  const session = await createSession(c.env, { stationId: station.id, expiresAt: station.expires_at });
  setCookie(c, SESSION_COOKIE, session.token, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', expires: new Date(session.expiresAt) });
  await auditStatement(c.env.DB, { actor: { type: 'station', id: station.id }, action: 'station.pair', eventId: station.event_id, targetType: 'station', targetId: station.id }).run();
  return c.json({ ok: true });
});

/** Who has (and hasn't) been served at a meal, for the meal team. */
scanRoutes.get('/meals/:mealId/served', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = z.uuid().safeParse(c.req.param('mealId'));
  if (!mealId.success) throw notFound();
  const { ctx } = await authorisedContext(c, eventId, 'meal', mealId.data);
  const { states } = replay(ctx.rules, await loadTimeline(c.env.DB, eventId, ctx));
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.first_name, p.preferred_name, p.last_name, r.group_name, r.kind
       FROM registrations r JOIN people p ON p.id = r.person_id
      WHERE r.event_id = ? AND r.status = 'active'
      ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
  )
    .bind(eventId)
    .all<Record<string, string>>();
  return c.json({
    meal: { id: ctx.id, name: ctx.name },
    people: results.map((r) => {
      const state = states.get(r.id!);
      return {
        id: r.id,
        name: `${r.preferred_name || r.first_name} ${r.last_name}`,
        group: r.group_name,
        kind: r.kind,
        servedAt: state?.present ? state.lastAcceptedAt : null,
      };
    }),
  });
});

/**
 * A leader's car rego, asked at their first scan (or skipped: rego null).
 * Anyone who can scan at this camp can record it; it's then shown on the
 * person's page to people who can see the roster.
 */
scanRoutes.post('/registrations/:registrationId/rego', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = c.get('principal');
  if (!principal) throw forbidden();
  const scans =
    can(principal, 'site.scan', { eventId }) ||
    can(principal, 'meal.scan', { eventId }) ||
    can(principal, 'roster.edit', { eventId }) ||
    activityAccess(principal, 'activity.scan', eventId) === 'all' ||
    (activityAccess(principal, 'activity.scan', eventId) as Set<string>).size > 0;
  if (!scans) throw forbidden();
  const id = z.uuid().safeParse(c.req.param('registrationId'));
  if (!id.success) throw notFound();
  const { rego } = await parseBody(c, z.strictObject({ rego: z.string().trim().max(20).nullable() }));
  const now = nowIso();
  const res = await c.env.DB.prepare(
    `UPDATE registrations SET car_rego = COALESCE(?, car_rego), car_rego_asked_at = COALESCE(car_rego_asked_at, ?), updated_at = ? WHERE id = ? AND event_id = ? AND kind = 'adult'`,
  )
    .bind(rego ? rego.toUpperCase() : null, now, now, id.data, eventId)
    .run();
  if (res.meta.changes !== 1) throw notFound();
  await auditStatement(c.env.DB, {
    actor: principal.kind === 'user' ? { type: 'user', id: principal.userId } : { type: 'station', id: principal.stationId },
    action: rego ? 'registration.car_rego' : 'registration.car_rego_skipped',
    eventId,
    targetType: 'registration',
    targetId: id.data,
  }).run();
  return c.json({ ok: true });
});
