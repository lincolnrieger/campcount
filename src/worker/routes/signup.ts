import { Hono } from 'hono';
import { z } from 'zod';
import { normaliseShortCode } from '../../shared/credentials';
import { displayName } from '../../shared/names';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { ApiError, conflict, notFound } from '../lib/errors';
import { hmacHex, randomToken, timingSafeEqualHex } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { hashToken } from '../services/credentials';
import { contextState, loadContext } from '../services/contexts';
import { can } from '../services/principal';

/**
 * Activity sign-up. People book activity sessions themselves:
 *   - at the sign-up screen (a tablet at HQ: /signup/<code>), by scanning
 *     their lanyard or typing the code printed on it;
 *   - from a session poster (/signup/<code>?activity=<id>);
 *   - from their own lanyard link (/c#<token>) on a phone.
 * Holding the lanyard (or its printed code) is what lets someone book for
 * that person. Bookings are what the activity scanner checks.
 */

const PASS_MINUTES = 30;

interface SignupEvent {
  id: string;
  name: string;
  status: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  feature_self_signup: number;
  signup_code: string | null;
}

export interface SignupSession {
  id: string;
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  booked: number;
  full: boolean;
}

async function sessions(db: D1Database, eventId: string): Promise<SignupSession[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.name, a.location, a.starts_at, a.ends_at, a.capacity,
              (SELECT count(*) FROM activity_bookings b WHERE b.activity_id = a.id) AS booked
         FROM activities a
        WHERE a.event_id = ? AND a.status = 'active' AND a.signup_open = 1
        ORDER BY a.starts_at IS NULL, a.starts_at, a.name COLLATE NOCASE`,
    )
    .bind(eventId)
    .all<{ id: string; name: string; location: string; starts_at: string | null; ends_at: string | null; capacity: number | null; booked: number }>();
  return results.map((a) => ({
    id: a.id,
    name: a.name,
    location: a.location,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    capacity: a.capacity,
    booked: a.booked,
    full: a.capacity !== null && a.booked >= a.capacity,
  }));
}

const signupOpen = (e: SignupEvent) => e.feature_self_signup === 1 && (e.status === 'open' || e.status === 'draft');

async function rateLimit(c: AppContext, key: string): Promise<void> {
  if (!c.env.AUTH_LIMITER) return;
  const { success } = await c.env.AUTH_LIMITER.limit({ key });
  if (!success) throw new ApiError(429, 'rate_limited', 'Too many tries. Wait a minute and try again.');
}

const limitByIp = (c: AppContext, bucket: string) => {
  const ip = c.req.header('CF-Connecting-IP');
  return ip ? rateLimit(c, `${bucket}:${ip}`) : Promise.resolve();
};

/** A short-lived pass for one person, so each booking doesn't need the lanyard again. */
async function makePass(c: AppContext, registrationId: string): Promise<string> {
  const expires = Date.now() + PASS_MINUTES * 60_000;
  return `${registrationId}.${expires}.${await hmacHex(c.env.AUTH_SECRET, `signup:${registrationId}:${expires}`)}`;
}

async function readPass(c: AppContext, pass: string): Promise<string> {
  const [registrationId, expires, mac] = pass.split('.');
  const bad = () => new ApiError(401, 'signed_out', 'Scan your lanyard again to carry on.');
  if (!registrationId || !expires || !mac || Number(expires) < Date.now()) throw bad();
  if (!timingSafeEqualHex(mac, await hmacHex(c.env.AUTH_SECRET, `signup:${registrationId}:${expires}`))) throw bad();
  return registrationId;
}

interface Person {
  registrationId: string;
  event: SignupEvent;
  name: string;
  groupName: string;
}

async function personFor(c: AppContext, registrationId: string): Promise<Person> {
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.group_name, p.first_name, p.preferred_name, p.last_name,
            e.id AS event_id, e.name AS event_name, e.status, e.timezone, e.starts_on, e.ends_on, e.feature_self_signup, e.signup_code
       FROM registrations r JOIN people p ON p.id = r.person_id JOIN events e ON e.id = r.event_id
      WHERE r.id = ? AND r.status = 'active'`,
  )
    .bind(registrationId)
    .first<Record<string, string | number | null>>();
  if (!row) throw new ApiError(401, 'signed_out', 'Scan your lanyard again to carry on.');
  return {
    registrationId,
    name: displayName(String(row.first_name), String(row.preferred_name), String(row.last_name)),
    groupName: String(row.group_name),
    event: {
      id: String(row.event_id),
      name: String(row.event_name),
      status: String(row.status),
      timezone: String(row.timezone),
      starts_on: String(row.starts_on),
      ends_on: String(row.ends_on),
      feature_self_signup: Number(row.feature_self_signup),
      signup_code: row.signup_code as string | null,
    },
  };
}

async function personView(c: AppContext, p: Person) {
  const [list, booked] = await Promise.all([
    sessions(c.env.DB, p.event.id),
    c.env.DB.prepare(
      `SELECT b.activity_id, b.source, a.name, a.location, a.starts_at, a.ends_at
         FROM activity_bookings b JOIN activities a ON a.id = b.activity_id
        WHERE b.registration_id = ? ORDER BY a.starts_at IS NULL, a.starts_at`,
    )
      .bind(p.registrationId)
      .all<{ activity_id: string; source: string; name: string; location: string; starts_at: string | null; ends_at: string | null }>(),
  ]);
  return {
    pass: await makePass(c, p.registrationId),
    person: { name: p.name, groupName: p.groupName },
    event: { name: p.event.name, timezone: p.event.timezone, startsOn: p.event.starts_on, endsOn: p.event.ends_on },
    open: signupOpen(p.event),
    sessions: list,
    bookings: booked.results.map((b) => ({
      activityId: b.activity_id,
      name: b.name,
      location: b.location,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      // Bookings made by the event team can only be changed by them.
      canCancel: b.source === 'self_signup',
    })),
  };
}

export const publicSignupRoutes = new Hono<AppEnv>();

async function eventByCode(c: AppContext, code: string): Promise<SignupEvent> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) throw notFound();
  const e = await c.env.DB.prepare(
    `SELECT id, name, status, timezone, starts_on, ends_on, feature_self_signup, signup_code FROM events WHERE signup_code = ?`,
  )
    .bind(code)
    .first<SignupEvent>();
  if (!e) throw notFound();
  return e;
}

/** The sign-up screen before anyone has scanned: what's on and how full it is. Names are never shown. */
publicSignupRoutes.get('/event/:code', async (c) => {
  const e = await eventByCode(c, c.req.param('code'));
  return c.json({
    event: { name: e.name, timezone: e.timezone, startsOn: e.starts_on, endsOn: e.ends_on },
    open: signupOpen(e),
    sessions: signupOpen(e) ? await sessions(c.env.DB, e.id) : [],
  });
});

const identifySchema = z.union([
  z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{22}$/), code: z.string().max(64).optional() }),
  z.strictObject({ shortCode: z.string().trim().max(12), code: z.string().max(64) }),
]);

/** Scan a lanyard (token) or type its printed code (with the screen's event code). */
publicSignupRoutes.post('/identify', async (c) => {
  const input = await parseBody(c, identifySchema);
  await limitByIp(c, 'signup-identify');
  const notRecognised = () => new ApiError(404, 'not_recognised', "That card wasn't recognised. Check the code, or ask a leader.");
  let row: { registration_id: string; event_id: string } | null;
  if ('token' in input) {
    row = await c.env.DB.prepare(`SELECT registration_id, event_id FROM credentials WHERE token_hash = ? AND status = 'active'`)
      .bind(await hashToken(input.token))
      .first();
  } else {
    const e = await eventByCode(c, input.code);
    row = await c.env.DB.prepare(`SELECT registration_id, event_id FROM credentials WHERE event_id = ? AND short_code = ? AND status = 'active'`)
      .bind(e.id, normaliseShortCode(input.shortCode))
      .first();
  }
  if (!row) throw notRecognised();
  const person = await personFor(c, row.registration_id).catch(() => {
    throw notRecognised();
  });
  // A lanyard from another event can't be used at this event's screen.
  if (input.code && person.event.signup_code !== input.code) throw notRecognised();
  return c.json(await personView(c, person));
});

const bookingSchema = z.strictObject({ pass: z.string().max(200), activityId: z.uuid() });

publicSignupRoutes.post('/book', async (c) => {
  const { pass, activityId } = await parseBody(c, bookingSchema);
  await limitByIp(c, 'signup-book');
  const person = await personFor(c, await readPass(c, pass));
  if (!signupOpen(person.event)) throw conflict('Activity sign-up is closed.');
  const activity = await c.env.DB.prepare(
    `SELECT id, name, starts_at, ends_at, capacity FROM activities WHERE id = ? AND event_id = ? AND status = 'active' AND signup_open = 1`,
  )
    .bind(activityId, person.event.id)
    .first<{ id: string; name: string; starts_at: string | null; ends_at: string | null; capacity: number | null }>();
  if (!activity) throw notFound();
  if (activity.starts_at) {
    // No two sessions at the same time (a session with no end time counts as an hour).
    const span = (start: string, end: string | null) => [Date.parse(start), end ? Date.parse(end) : Date.parse(start) + 3_600_000] as const;
    const [start, end] = span(activity.starts_at, activity.ends_at);
    const { results } = await c.env.DB.prepare(
      `SELECT a.name, a.starts_at, a.ends_at FROM activity_bookings b JOIN activities a ON a.id = b.activity_id
        WHERE b.registration_id = ? AND a.id <> ? AND a.starts_at IS NOT NULL`,
    )
      .bind(person.registrationId, activity.id)
      .all<{ name: string; starts_at: string; ends_at: string | null }>();
    const clash = results.find((o) => {
      const [s2, e2] = span(o.starts_at, o.ends_at);
      return s2 < end && e2 > start;
    });
    if (clash) throw conflict(`That clashes with ${clash.name}. Cancel that first if you'd rather do this.`);
  }
  // Atomic: only books if a place is still free.
  const res = await c.env.DB.prepare(
    `INSERT INTO activity_bookings (activity_id, registration_id, event_id, source, created_at)
     SELECT ?1, ?2, ?3, 'self_signup', ?4
      WHERE ?5 IS NULL OR (SELECT count(*) FROM activity_bookings WHERE activity_id = ?1) < ?5
     ON CONFLICT (activity_id, registration_id) DO NOTHING`,
  )
    .bind(activity.id, person.registrationId, person.event.id, nowIso(), activity.capacity)
    .run();
  if (res.meta.changes !== 1) {
    const already = await c.env.DB.prepare(`SELECT 1 FROM activity_bookings WHERE activity_id = ? AND registration_id = ?`)
      .bind(activity.id, person.registrationId)
      .first();
    if (!already) throw conflict(`${activity.name} is full.`);
  } else {
    await auditStatement(c.env.DB, {
      actor: { type: 'public' },
      action: 'booking.self',
      eventId: person.event.id,
      targetType: 'registration',
      targetId: person.registrationId,
      detail: { activityId: activity.id, name: activity.name },
    }).run();
  }
  return c.json(await personView(c, person));
});

publicSignupRoutes.post('/cancel', async (c) => {
  const { pass, activityId } = await parseBody(c, bookingSchema);
  await limitByIp(c, 'signup-book');
  const person = await personFor(c, await readPass(c, pass));
  const res = await c.env.DB.prepare(`DELETE FROM activity_bookings WHERE activity_id = ? AND registration_id = ? AND source = 'self_signup'`)
    .bind(activityId, person.registrationId)
    .run();
  if (res.meta.changes === 1) {
    await auditStatement(c.env.DB, {
      actor: { type: 'public' },
      action: 'booking.self_cancel',
      eventId: person.event.id,
      targetType: 'registration',
      targetId: person.registrationId,
      detail: { activityId },
    }).run();
  }
  return c.json(await personView(c, person));
});

// ---------------------------------------------------------------- event managers

export const signupRoutes = new Hono<AppEnv>();

/** The sign-up screen's link (made on first use) and the sessions open for sign-up. */
signupRoutes.get('/signup', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const e = await c.env.DB.prepare(`SELECT signup_code, feature_self_signup FROM events WHERE id = ?`)
    .bind(eventId)
    .first<{ signup_code: string | null; feature_self_signup: number }>();
  if (!e) throw notFound();
  let code = e.signup_code;
  if (!code) {
    code = randomToken(12);
    await c.env.DB.prepare(`UPDATE events SET signup_code = ? WHERE id = ? AND signup_code IS NULL`).bind(code, eventId).run();
    code = (await c.env.DB.prepare(`SELECT signup_code FROM events WHERE id = ?`).bind(eventId).first<{ signup_code: string }>())!.signup_code;
  }
  return c.json({
    enabled: e.feature_self_signup === 1,
    link: `${new URL(c.req.url).origin}/signup/${code}`,
    sessions: await sessions(c.env.DB, eventId),
  });
});

/** A new sign-up link; the old link and printed posters stop working. */
signupRoutes.post('/signup/new-link', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE events SET signup_code = ? WHERE id = ?`).bind(randomToken(12), eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'signup.new_link', eventId, targetType: 'event', targetId: eventId }),
  ]);
  return c.json({ ok: true });
});

/** Event managers, or the activity's own leaders. */
function requireBookings(c: AppContext, eventId: string, activityId: string) {
  if (can(requirePrincipal(c), 'activities.manage', { eventId })) return;
  requirePermission(c, 'activity.bookings', { eventId, activityId });
}

/** Who is booked on an activity session. */
signupRoutes.get('/activities/:activityId/bookings', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireBookings(c, eventId, c.req.param('activityId'));
  const { results } = await c.env.DB.prepare(
    `SELECT b.registration_id, b.source, b.created_at, p.first_name, p.preferred_name, p.last_name, r.group_name
       FROM activity_bookings b JOIN registrations r ON r.id = b.registration_id JOIN people p ON p.id = r.person_id
      WHERE b.activity_id = ? AND b.event_id = ? ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
  )
    .bind(c.req.param('activityId'), eventId)
    .all<Record<string, string>>();
  return c.json({
    bookings: results.map((b) => ({
      registrationId: b.registration_id,
      name: `${b.preferred_name || b.first_name} ${b.last_name}`,
      groupName: b.group_name,
      source: b.source,
      createdAt: b.created_at,
    })),
  });
});

/** The event team books someone (ignores the capacity limit) or removes a booking. */
signupRoutes.post('/activities/:activityId/bookings', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireBookings(c, eventId, c.req.param('activityId'));
  const user = requireUser(c);
  const { registrationId } = await parseBody(c, z.strictObject({ registrationId: z.uuid() }));
  const activityId = c.req.param('activityId');
  const ok = await c.env.DB.prepare(
    `SELECT 1 FROM activities a, registrations r WHERE a.id = ? AND a.event_id = ? AND r.id = ? AND r.event_id = ? AND r.status = 'active'`,
  )
    .bind(activityId, eventId, registrationId, eventId)
    .first();
  if (!ok) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO activity_bookings (activity_id, registration_id, event_id, source, created_at) VALUES (?, ?, ?, 'manual', ?)
       ON CONFLICT (activity_id, registration_id) DO NOTHING`,
    ).bind(activityId, registrationId, eventId, nowIso()),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'booking.add', eventId, targetType: 'registration', targetId: registrationId, detail: { activityId } }),
  ]);
  return c.json({ ok: true });
});

signupRoutes.delete('/activities/:activityId/bookings/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireBookings(c, eventId, c.req.param('activityId'));
  const user = requireUser(c);
  const registrationId = c.req.param('registrationId');
  const activityId = c.req.param('activityId');
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM activity_bookings WHERE activity_id = ? AND registration_id = ? AND event_id = ?`).bind(activityId, registrationId, eventId),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: user.userId },
      action: 'booking.remove',
      eventId,
      targetType: 'registration',
      targetId: registrationId,
      detail: { activityId },
    }),
  ]);
  if (res!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

/**
 * An activity's roster for its leaders: everyone booked or scanned in, with
 * whether they're here now, plus the event roster (names only) for adding
 * walk-ins. Check-ins themselves go through the normal scan upload.
 */
signupRoutes.get('/activities/:activityId/attendance', async (c) => {
  const eventId = c.req.param('eventId')!;
  const activityId = z.uuid().safeParse(c.req.param('activityId'));
  if (!activityId.success) throw notFound();
  const principal = requirePermission(c, 'activity.view_roster', { eventId, activityId: activityId.data });
  const ctx = await loadContext(c.env.DB, eventId, 'activity', activityId.data);
  const [activity, people, bookings, state] = await Promise.all([
    c.env.DB.prepare(`SELECT name, location, instructions, starts_at, ends_at, capacity, track_sign_out, signup_open, booking_required, status FROM activities WHERE id = ?`)
      .bind(activityId.data)
      .first<Record<string, string | number | null>>(),
    c.env.DB.prepare(
      `SELECT r.id, p.first_name, p.preferred_name, p.last_name, r.group_name, r.section, r.kind, r.photo_consent
         FROM registrations r JOIN people p ON p.id = r.person_id
        WHERE r.event_id = ? AND r.status = 'active' ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
    )
      .bind(eventId)
      .all<Record<string, string>>(),
    c.env.DB.prepare(`SELECT registration_id FROM activity_bookings WHERE activity_id = ?`).bind(activityId.data).all<{ registration_id: string }>(),
    contextState(c.env.DB, eventId, ctx),
  ]);
  const booked = new Set(bookings.results.map((b) => b.registration_id));
  const photos = can(principal, 'photo.view_status', { eventId });
  const byId = new Map(people.results.map((p) => [p.id!, p]));
  const involved = new Set([...booked, ...[...state.states].filter(([, s]) => s.visits > 0).map(([id]) => id)]);
  const row = (id: string) => {
    const p = byId.get(id)!;
    const s = state.states.get(id);
    return {
      id,
      name: `${p.preferred_name || p.first_name} ${p.last_name}`,
      groupName: p.group_name,
      section: p.kind === 'adult' ? 'Leader' : p.section,
      booked: booked.has(id),
      present: s?.present ?? false,
      visits: s?.visits ?? 0,
      lastAt: s?.lastAcceptedAt ?? null,
      ...(photos ? { noPhotos: p.photo_consent === 'no' } : {}),
    };
  };
  return c.json({
    activity: {
      id: activityId.data,
      name: activity!.name,
      location: activity!.location,
      instructions: activity!.instructions,
      startsAt: activity!.starts_at,
      endsAt: activity!.ends_at,
      capacity: activity!.capacity,
      trackSignOut: activity!.track_sign_out === 1,
      signupOpen: activity!.signup_open === 1,
      bookingRequired: activity!.booking_required === 1,
      status: activity!.status,
    },
    presentNow: state.presentNow,
    canBook: can(principal, 'activities.manage', { eventId }) || can(principal, 'activity.bookings', { eventId, activityId: activityId.data }),
    canCheckIn: can(principal, 'activity.scan', { eventId, activityId: activityId.data }),
    people: [...involved].filter((id) => byId.has(id)).map(row),
    everyone: people.results.map((p) => ({ id: p.id, name: `${p.preferred_name || p.first_name} ${p.last_name}`, groupName: p.group_name })),
  });
});
