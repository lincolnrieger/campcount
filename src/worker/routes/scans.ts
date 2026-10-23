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
import { auditStatement } from '../services/audit';
import type { ScanContext } from '../services/contexts';
import { canScan, loadContext, loadTimeline } from '../services/contexts';
import type { Principal } from '../services/principal';
import { can } from '../services/principal';
import { SESSION_COOKIE, createSession } from '../services/sessions';
import { getEventRow } from './events';
import { displayName } from './roster';

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
 * Raw tokens and typed codes are never included, only their hashes.
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

  const [people, credentials, dietary, bookings, timeline] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name, r.photo_consent, r.status
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
        memberNumber: p.member_number,
        group: p.group_name,
        section: p.section,
        kind: p.kind,
        withdrawn: p.status === 'withdrawn',
        booked: booked.has(p.id!),
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
  for (const item of input.scans) {
    let cred: { id: string; registration_id: string } | null = null;
    if (item.credentialHash) {
      cred = await c.env.DB.prepare(`SELECT id, registration_id FROM credentials WHERE token_hash = ? AND event_id = ?`)
        .bind(item.credentialHash, eventId)
        .first();
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
      const reg = await c.env.DB.prepare(`SELECT id FROM registrations WHERE id = ? AND event_id = ?`).bind(item.registrationId, eventId).first();
      registrationId = reg ? item.registrationId : null;
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
    results.push({
      id: r.item.id,
      outcome: evaluation?.outcome ?? 'review',
      message: evaluation?.message ?? 'Recorded for review.',
      warning: evaluation?.warning ?? null,
      registrationId: r.registrationId,
    });
  }
  return c.json({ results, serverTime: now });
});

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
  return c.json({ id });
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

// ---------------------------------------------------------------- station pairing (no account needed)

export const pairingRoutes = new Hono<AppEnv>();

pairingRoutes.post('/pair', async (c) => {
  const { code } = await parseBody(c, z.strictObject({ code: z.string().trim().min(8).max(12) }));
  const ip = c.req.header('CF-Connecting-IP');
  if (ip && c.env.AUTH_LIMITER) {
    const { success } = await c.env.AUTH_LIMITER.limit({ key: `pair:${ip}` });
    if (!success) throw new ApiError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
  }
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
