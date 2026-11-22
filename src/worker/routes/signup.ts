import { Hono } from 'hono';
import { z } from 'zod';
import { normaliseShortCode } from '../../shared/credentials';
import { displayName } from '../../shared/names';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { ApiError, badRequest, conflict, notFound } from '../lib/errors';
import { hmacHex, randomToken, timingSafeEqualHex } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { limitPerKey, limitPublicNetwork } from '../lib/rateLimit';
import { auditStatement } from '../services/audit';
import { hashToken } from '../services/credentials';
import { contextState, loadContext } from '../services/contexts';
import { can } from '../services/principal';
import { addMember, createTeam, findByMemberNumber, participantTeams, removeMember, teamEventRow, teamRow } from '../services/teams';
import { teamNameSchema } from '../../shared/schemas';
import type { LinkFeature } from '../../shared/participantLinks';
import { ALL_FEATURES, featuresOf, hasFeature, maskOf, participantLinkPatchSchema, participantLinkSchema } from '../../shared/participantLinks';
import type { MealItem } from '../../shared/mealItems';
import { ALLERGENS, dietProfile, participantItems } from '../../shared/mealItems';
import { itemFromRow, loadItems } from './mealItems';
import { parseSectionSettings, sectionStyle } from '../../shared/sections';
import { bannerUrl } from './banner';
import { dutiesFor } from './duties';
import { activitiesDone, collect, meIsValid, readMe, standing, writeMe } from '../services/sideQuest';

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
  feature_side_quest: number;
  signup_code: string | null;
  section_settings: string | null;
  youth_sections: string;
  contact_email?: string;
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
        WHERE a.event_id = ? AND a.status = 'active' AND a.signup_open = 1 AND a.kind = 'activity'
          AND NOT EXISTS (SELECT 1 FROM team_events t WHERE t.activity_id = a.id)
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


/**
 * A short-lived pass for one person, so each booking doesn't need the lanyard
 * again. It names the lanyard it came from, so cancelling a lost lanyard ends
 * its pass straight away.
 */
interface Pass {
  registrationId: string;
  credentialId: string;
  /** Opened by typing a membership number (which anyone could type): the page leaves out personal details. */
  reduced?: boolean;
  /** From a link for everyone: the parts of the page it switches on (bits, see shared/participantLinks). Unset: all. */
  mask?: number;
}

async function makePass(c: AppContext, p: Pass): Promise<string> {
  const expires = Date.now() + PASS_MINUTES * 60_000;
  const body = `${p.registrationId}.${p.credentialId}.${expires}${p.reduced ? `.r${p.mask ?? ''}` : ''}`;
  return `${body}.${await hmacHex(c.env.AUTH_SECRET, `signup:${body}`)}`;
}

async function readPass(c: AppContext, pass: string): Promise<Pass> {
  const parts = pass.split('.');
  const flag = parts.length === 5 ? /^r(\d{1,2})?$/.exec(parts[3] ?? '') : null;
  const reduced = flag !== null;
  const [registrationId, credentialId, expires] = parts;
  const mac = parts[parts.length - 1];
  const bad = () => new ApiError(401, 'signed_out', reduced ? 'Your page timed out. Type your membership number again.' : 'Scan your lanyard again to carry on.');
  if ((parts.length !== 4 && !reduced) || !registrationId || !credentialId || !expires || !mac || Number(expires) < Date.now()) throw bad();
  const body = `${registrationId}.${credentialId}.${expires}${reduced ? `.${parts[3]}` : ''}`;
  if (!timingSafeEqualHex(mac, await hmacHex(c.env.AUTH_SECRET, `signup:${body}`))) throw bad();
  return { registrationId, credentialId, reduced, mask: flag?.[1] !== undefined ? Number(flag[1]) : undefined };
}

/**
 * Check a pass, then limit that one person's changes (10 a minute). Limiting
 * per person rather than per network means a whole camp on one Wi-Fi can
 * sign up at once.
 */
async function limitedPass(c: AppContext, pass: string): Promise<Pass> {
  const p = await readPass(c, pass);
  await limitPerKey(c, `signup:${p.registrationId}`, 'Too many changes at once. Wait a minute and try again.');
  return p;
}

interface Person {
  registrationId: string;
  credentialId: string;
  reduced: boolean;
  mask?: number;
  event: SignupEvent;
  name: string;
  firstName: string;
  lastName: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
}

async function personFor(c: AppContext, { registrationId, credentialId, reduced, mask }: Pass): Promise<Person> {
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.group_name, r.kind, r.section, p.first_name, p.preferred_name, p.last_name,
            e.id AS event_id, e.name AS event_name, e.status, e.timezone, e.starts_on, e.ends_on, e.feature_self_signup, e.feature_side_quest, e.signup_code,
            e.section_settings, e.youth_sections, e.contact_email
       FROM registrations r JOIN people p ON p.id = r.person_id JOIN events e ON e.id = r.event_id
       JOIN credentials cr ON cr.registration_id = r.id AND cr.id = ? AND cr.status = 'active'
      WHERE r.id = ? AND r.status = 'active'`,
  )
    .bind(credentialId, registrationId)
    .first<Record<string, string | number | null>>();
  if (!row) throw new ApiError(401, 'signed_out', 'Scan your lanyard again to carry on.');
  return {
    registrationId,
    credentialId,
    reduced: reduced === true,
    mask: reduced ? mask : undefined,
    name: displayName(String(row.first_name), String(row.preferred_name), String(row.last_name)),
    firstName: String(row.preferred_name || row.first_name),
    lastName: String(row.last_name ?? ''),
    kind: row.kind === 'adult' ? 'adult' : 'youth',
    section: String(row.section ?? ''),
    groupName: String(row.group_name),
    event: {
      id: String(row.event_id),
      name: String(row.event_name),
      status: String(row.status),
      timezone: String(row.timezone),
      starts_on: String(row.starts_on),
      ends_on: String(row.ends_on),
      feature_self_signup: Number(row.feature_self_signup),
      feature_side_quest: Number(row.feature_side_quest),
      signup_code: row.signup_code as string | null,
      section_settings: row.section_settings as string | null,
      youth_sections: String(row.youth_sections ?? ''),
      contact_email: String(row.contact_email ?? ''),
    },
  };
}

/** A link for everyone can leave parts of the page off; actions for those parts are refused too. */
function requireFeature(p: Person, f: LinkFeature) {
  if (!hasFeature(p.mask, f)) throw new ApiError(403, 'forbidden', 'This link doesn’t include that.');
}

/** The word and colour for someone's section at their camp (Settings › Sections). */
function styleOf(p: Person) {
  return sectionStyle(parseSectionSettings(p.event.section_settings, p.event.youth_sections), p.section);
}

/**
 * The whole camp programme, for people looking at their own lanyard page:
 * activities (with how many places are taken), meals (with the menu and
 * ingredients, so people can check them against their dietary needs) and
 * programme items.
 */
async function programme(db: D1Database, eventId: string) {
  const [acts, meals] = await Promise.all([
    db
      .prepare(
        `SELECT a.name, a.location, a.starts_at, a.ends_at, a.kind, a.capacity,
                (SELECT count(*) FROM activity_bookings b WHERE b.activity_id = a.id) AS booked
           FROM activities a WHERE a.event_id = ? AND a.status = 'active'`,
      )
      .bind(eventId)
      .all<{ name: string; location: string; starts_at: string | null; ends_at: string | null; kind: string; capacity: number | null; booked: number }>(),
    db
      .prepare(
        `SELECT id, name, location, starts_at, ends_at, menu, ingredients, (SELECT count(*) FROM meal_items i WHERE i.meal_id = meal_services.id) AS item_count
           FROM meal_services WHERE event_id = ? AND status = 'active'`,
      )
      .bind(eventId)
      .all<{ id: string; name: string; location: string; starts_at: string | null; ends_at: string | null; menu: string; ingredients: string; item_count: number }>(),
  ]);
  return [
    ...acts.results.map((a) => {
      const program = a.kind === 'program';
      return {
        name: a.name,
        location: a.location,
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        kind: program ? 'program' : 'activity',
        capacity: program ? null : a.capacity,
        booked: program ? 0 : a.booked,
      };
    }),
    ...meals.results.map((m) => ({
      mealId: m.id,
      itemCount: m.item_count,
      name: m.name,
      location: m.location,
      startsAt: m.starts_at,
      endsAt: m.ends_at,
      kind: 'meal',
      capacity: null,
      booked: 0,
      menu: m.menu,
      ingredients: m.ingredients,
    })),
  ].sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name));
}

async function personView(c: AppContext, base: Person, opts: { sideQuest?: boolean; reduced?: boolean; mask?: number } = {}) {
  const p = opts.reduced ? { ...base, reduced: true, mask: opts.mask ?? base.mask } : base;
  const on = (f: LinkFeature) => hasFeature(p.mask, f);
  const sideQuestOn = opts.sideQuest === true && p.event.feature_side_quest === 1;
  const [list, booked, programmeList, teams, done, quest, duties, banner] = await Promise.all([
    sessions(c.env.DB, p.event.id),
    c.env.DB.prepare(
      `SELECT b.activity_id, b.source, a.name, a.location, a.starts_at, a.ends_at
         FROM activity_bookings b JOIN activities a ON a.id = b.activity_id
        WHERE b.registration_id = ? ORDER BY a.starts_at IS NULL, a.starts_at`,
    )
      .bind(p.registrationId)
      .all<{ activity_id: string; source: string; name: string; location: string; starts_at: string | null; ends_at: string | null }>(),
    programme(c.env.DB, p.event.id),
    participantTeams(c.env.DB, p.event.id, p.registrationId),
    activitiesDone(c.env.DB, p.event.id, p.registrationId),
    sideQuestOn ? standing(c.env.DB, p.event.id, p.registrationId) : Promise.resolve(null),
    dutiesFor(c.env.DB, p.event.id, p.registrationId),
    bannerUrl(c.env.DB, p.event.id),
  ]);
  return {
    pass: await makePass(c, p),
    person: {
      name: p.name,
      firstName: p.firstName,
      // A typed membership number could be anyone's: no surname or group.
      lastName: p.reduced ? '' : p.lastName,
      kind: p.kind,
      groupName: p.reduced ? '' : p.groupName,
      section: p.section,
      sectionWord: styleOf(p).word,
      sectionColour: styleOf(p).bg,
    },
    activitiesDone: done,
    // Only on someone's own link, and only once the camp has turned the game on.
    sideQuest: quest,
    // Leader roster: where this person is rostered on, soonest first (not for a typed number).
    duties: p.reduced ? [] : duties,
    event: { name: p.event.name, timezone: p.event.timezone, startsOn: p.event.starts_on, endsOn: p.event.ends_on, banner, contactEmail: p.event.contact_email ?? '' },
    // The parts of the page this link shows (all of them on someone's own lanyard).
    features: featuresOf(p.mask ?? ALL_FEATURES),
    open: signupOpen(p.event),
    sessions: on('book') ? list : [],
    programme: programmeList.filter((i) => (i.kind === 'meal' ? on('food') : on('programme'))),
    // Teams are for young people.
    teamEvents: !on('teams') ? [] : teamsOpen(p.event) && p.kind !== 'adult' ? (p.reduced ? teams.map((t) => (t.myTeam ? { ...t, myTeam: { ...t.myTeam, members: [], joinCode: null } } : t)) : teams) : [],
    bookings: booked.results.map((b) => ({
      activityId: b.activity_id,
      name: b.name,
      location: b.location,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      // Bookings made by the event team, and team places (changed on the Teams tab), can only be changed there.
      canCancel: on('book') && b.source === 'self_signup' && !teams.some((t) => t.id === b.activity_id),
    })),
  };
}

export const publicSignupRoutes = new Hono<AppEnv>();

async function eventByCode(c: AppContext, code: string): Promise<SignupEvent> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) throw notFound();
  const e = await c.env.DB.prepare(
    `SELECT id, name, status, timezone, starts_on, ends_on, feature_self_signup, feature_side_quest, signup_code FROM events WHERE signup_code = ?`,
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
  // A lanyard link opened on a phone (or the kiosk camera, with the screen's code).
  // claim: "this is my card", making this phone belong to this person.
  z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{22}$/), code: z.string().max(64).optional(), claim: z.boolean().optional() }),
  z.strictObject({ shortCode: z.string().trim().max(24), code: z.string().max(64) }),
]);

/**
 * Scan a lanyard (token) or type its printed code (with the screen's event code).
 *
 * Someone's own link, opened on a phone, also makes that phone theirs (a
 * signed cookie). If the camp plays the Side Quest and the phone already
 * belongs to someone else at the camp, opening this link collects this
 * person for them instead of showing this person's page.
 */
publicSignupRoutes.post('/identify', async (c) => {
  const input = await parseBody(c, identifySchema);
  await limitPublicNetwork(c, 'signup-identify');
  const notRecognised = () => new ApiError(404, 'not_recognised', "That card wasn't recognised. Check the code, or ask a leader.");
  let row: { id: string; registration_id: string; event_id: string } | null;
  if ('token' in input) {
    row = await c.env.DB.prepare(`SELECT id, registration_id, event_id FROM credentials WHERE token_hash = ? AND status = 'active'`)
      .bind(await hashToken(input.token))
      .first();
  } else {
    const e = await eventByCode(c, input.code);
    // Typed codes are membership numbers, so guessable: few tries per device, and a reduced page (below).
    await limitPerKey(c, `kiosk-typed:${e.id}:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`, 'Too many codes typed. Wait a minute, or scan the lanyard’s QR code.');
    row = await c.env.DB.prepare(`SELECT id, registration_id, event_id FROM credentials WHERE event_id = ? AND short_code = ? AND status = 'active'`)
      .bind(e.id, normaliseShortCode(input.shortCode))
      .first();
  }
  if (!row) throw notRecognised();
  const person = await personFor(c, { registrationId: row.registration_id, credentialId: row.id }).catch(() => {
    throw notRecognised();
  });
  // A lanyard from another event can't be used at this event's screen.
  if (input.code && person.event.signup_code !== input.code) throw notRecognised();

  // The kiosk and typed codes are shared screens: they never belong to anyone.
  const ownLink = 'token' in input && !input.code;
  // A typed number could be anyone's: show just enough to book (no surname, group, duties or team-mates).
  if (!ownLink) return c.json(await personView(c, person, { reduced: !('token' in input) }));

  const scanned = { registrationId: person.registrationId, credentialId: person.credentialId };
  const claim = 'claim' in input && input.claim === true;
  const me = claim ? null : await readMe(c);
  const mine = me && me.registrationId === person.registrationId;
  const someoneElse = me && !mine && (await meIsValid(c.env.DB, me, person.event.id));

  if (someoneElse && person.event.feature_side_quest === 1) {
    const fresh = await collect(c.env.DB, person.event.id, me.registrationId, person.registrationId);
    const owner = await personFor(c, me).catch(() => null);
    if (owner) {
      return c.json({
        collect: {
          fresh,
          friend: { firstName: person.firstName, section: person.section, kind: person.kind, sectionWord: styleOf(person).word },
          owner: { firstName: owner.firstName },
          standing: await standing(c.env.DB, person.event.id, owner.registrationId),
        },
      });
    }
  }
  // Without the game, a phone that's someone else's just shows this card's page, as before.
  if (!someoneElse) await writeMe(c, scanned, person.event.ends_on);
  return c.json(await personView(c, person, { sideQuest: !someoneElse }));
});

/** The page of whoever this phone belongs to (after collecting a friend, or opening /c without a link). */
publicSignupRoutes.post('/me', async (c) => {
  await parseBody(c, z.strictObject({}));
  await limitPublicNetwork(c, 'signup-identify');
  const me = await readMe(c);
  const person = me ? await personFor(c, me).catch(() => null) : null;
  // Once the camp is over, the phone no longer opens their page by itself.
  if (!person || (person.event.status !== 'open' && person.event.status !== 'draft')) throw new ApiError(404, 'not_recognised', 'Scan your own lanyard with your phone camera to open your page.');
  return c.json(await personView(c, person, { sideQuest: true }));
});

const bookingSchema = z.strictObject({ pass: z.string().max(200), activityId: z.uuid() });

/**
 * Book someone onto an activity open for sign-up: no clashes (a session
 * with no end counts as an hour) and only while a place is free. Returns
 * whether it was already booked.
 */
async function bookActivity(c: AppContext, eventId: string, registrationId: string, activityId: string): Promise<{ name: string; already: boolean }> {
  const activity = await c.env.DB.prepare(
    `SELECT id, name, starts_at, ends_at, capacity FROM activities WHERE id = ? AND event_id = ? AND status = 'active' AND signup_open = 1
        AND NOT EXISTS (SELECT 1 FROM team_events t WHERE t.activity_id = activities.id)`,
  )
    .bind(activityId, eventId)
    .first<{ id: string; name: string; starts_at: string | null; ends_at: string | null; capacity: number | null }>();
  if (!activity) throw notFound();
  const already = await c.env.DB.prepare(`SELECT 1 FROM activity_bookings WHERE activity_id = ? AND registration_id = ?`).bind(activity.id, registrationId).first();
  if (already) return { name: activity.name, already: true };
  if (activity.starts_at) {
    const span = (start: string, end: string | null) => [Date.parse(start), end ? Date.parse(end) : Date.parse(start) + 3_600_000] as const;
    const [start, end] = span(activity.starts_at, activity.ends_at);
    const { results } = await c.env.DB.prepare(
      `SELECT a.name, a.starts_at, a.ends_at FROM activity_bookings b JOIN activities a ON a.id = b.activity_id
        WHERE b.registration_id = ? AND a.id <> ? AND a.starts_at IS NOT NULL`,
    )
      .bind(registrationId, activity.id)
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
    .bind(activity.id, registrationId, eventId, nowIso(), activity.capacity)
    .run();
  if (res.meta.changes !== 1) throw conflict(`${activity.name} is full.`);
  await auditStatement(c.env.DB, {
    actor: { type: 'public' },
    action: 'booking.self',
    eventId,
    targetType: 'registration',
    targetId: registrationId,
    detail: { activityId: activity.id, name: activity.name },
  }).run();
  return { name: activity.name, already: false };
}

publicSignupRoutes.post('/book', async (c) => {
  const { pass, activityId } = await parseBody(c, bookingSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  requireFeature(person, 'book');
  if (!signupOpen(person.event)) throw conflict('Activity sign-up is closed.');
  await bookActivity(c, person.event.id, person.registrationId, activityId);
  return c.json(await personView(c, person));
});

// ---------------------------------------------------------------- booking links (emailed before camp)

async function eventByBookingCode(c: AppContext, code: string): Promise<SignupEvent> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) throw notFound();
  const e = await c.env.DB.prepare(
    `SELECT id, name, status, timezone, starts_on, ends_on, feature_self_signup, feature_side_quest, signup_code, section_settings, youth_sections, contact_email FROM events WHERE booking_code = ?`,
  )
    .bind(code)
    .first<SignupEvent>();
  if (!e) throw notFound();
  return e;
}

/** One activity's booking page: what, when and where, and whether there's room. No names. */
publicSignupRoutes.get('/link/:code/:activityId', async (c) => {
  const e = await eventByBookingCode(c, c.req.param('code'));
  const session = (await sessions(c.env.DB, e.id)).find((s) => s.id === c.req.param('activityId'));
  if (!session) throw notFound();
  return c.json({ event: { name: e.name, timezone: e.timezone, startsOn: e.starts_on, endsOn: e.ends_on, contactEmail: e.contact_email ?? '' }, open: signupOpen(e), session });
});

/**
 * From an emailed link: type a membership number, get booked onto that
 * activity, and land on your own page (the reduced one, since anyone could
 * type a number) to see everything you're booked for and cancel. Says
 * nothing about who a number belongs to until it's typed.
 */
publicSignupRoutes.post('/link/:code/:activityId', async (c) => {
  const { memberNumber } = await parseBody(c, z.strictObject({ memberNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{1,24}$/, 'Type your membership number') }));
  await limitPublicNetwork(c, 'signup-book');
  await limitPerKey(c, `link-book:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`, 'Too many tries. Wait a minute and try again.');
  const e = await eventByBookingCode(c, c.req.param('code'));
  const who = await findByMemberNumber(c.env.DB, e.id, memberNumber);
  if (!who) throw conflict('That membership number isn’t registered for this camp. Check the number on your Scouts card or in MyScout.');
  const cred = await c.env.DB.prepare(`SELECT id FROM credentials WHERE registration_id = ? AND status = 'active'`).bind(who.id).first<{ id: string }>();
  if (!cred) throw conflict('Your camp card isn’t ready yet. Try again closer to camp, or ask your leader.');
  const person = await personFor(c, { registrationId: who.id, credentialId: cred.id, reduced: true });
  // Book this activity (leaders don't book); a reason it couldn't is shown on their page.
  let result: { booked: boolean; already: boolean; activity: string | null; problem: string | null } = { booked: false, already: false, activity: null, problem: null };
  if (who.kind === 'adult') result.problem = 'Leaders don’t need to book activities.';
  else if (!signupOpen(e)) result.problem = 'Booking is closed right now.';
  else {
    try {
      const r = await bookActivity(c, e.id, who.id, c.req.param('activityId'));
      result = { booked: true, already: r.already, activity: r.name, problem: null };
    } catch (err) {
      result.problem = err instanceof ApiError ? err.message : 'That couldn’t be booked.';
    }
  }
  return c.json({ ...(await personView(c, person, { reduced: true })), linkResult: result });
});

/**
 * Every meal's items for this person: what's in them (never staff notes),
 * and, if they have dietary needs recorded, what conflicts and their
 * alternative. Loaded when they open Food. A page opened by typing a
 * membership number gets the items without anything about their needs.
 */
publicSignupRoutes.post('/meals', async (c) => {
  const { pass } = await parseBody(c, z.strictObject({ pass: z.string().max(200) }));
  await limitPublicNetwork(c, 'signup-identify');
  const person = await personFor(c, await readPass(c, pass));
  requireFeature(person, 'food');
  const [items, entries] = await Promise.all([
    loadItems(c.env.DB, person.event.id),
    person.reduced
      ? Promise.resolve({ results: [] as { category: string; item: string; note: string }[] })
      : c.env.DB.prepare(`SELECT category, item, note FROM dietary_entries WHERE registration_id = ?`).bind(person.registrationId).all<{ category: string; item: string; note: string }>(),
  ]);
  const all = items.map((r) => itemFromRow(r, false));
  const customs = [...new Set(all.flatMap((i) => [...i.contains, ...i.mayContain]))].filter((a) => !(ALLERGENS as readonly string[]).includes(a));
  const profile = entries.results.length ? dietProfile(entries.results, customs) : null;
  const byMeal = new Map<string, MealItem[]>();
  for (const i of all) byMeal.set(i.mealId, [...(byMeal.get(i.mealId) ?? []), i]);
  return c.json({
    hasNeeds: !!profile && (profile.avoid.size > 0 || profile.suits.size > 0),
    meals: Object.fromEntries([...byMeal].map(([mealId, list]) => [mealId, participantItems(list, profile)])),
  });
});

publicSignupRoutes.post('/cancel', async (c) => {
  const { pass, activityId } = await parseBody(c, bookingSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  requireFeature(person, 'book');
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

// ---------------------------------------------------------------- teams (participants)

/** Teams can be made and joined while the event is a draft or open; each team event also has its own open/closed switch. */
const teamsOpen = (e: SignupEvent) => e.status === 'open' || e.status === 'draft';

async function openTeamEvent(c: AppContext, person: Person, activityId: string) {
  if (!teamsOpen(person.event)) throw conflict('Team sign-up is closed.');
  const te = await teamEventRow(c.env.DB, person.event.id, activityId);
  if (!te || te.status !== 'active') throw notFound();
  if (te.registration_open !== 1) throw conflict(`Teams for ${te.name} are closed. Ask a leader.`);
  return te;
}

async function notAlreadyOnATeam(c: AppContext, activityId: string, registrationId: string) {
  const mine = await c.env.DB.prepare(
    `SELECT t.name FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.activity_id = ? AND m.registration_id = ?`,
  )
    .bind(activityId, registrationId)
    .first<{ name: string }>();
  if (mine) throw conflict(`You're already on ${mine.name}. Leave it first.`);
}

const teamCreateSchema = z.strictObject({
  pass: z.string().max(200),
  activityId: z.uuid(),
  name: teamNameSchema.shape.name,
  /** Locked: only people with the team's code can join. */
  locked: z.boolean().default(false),
});
const teamJoinSchema = z.strictObject({ pass: z.string().max(200), teamId: z.uuid() });
const teamCodeSchema = z.strictObject({ pass: z.string().max(200), activityId: z.uuid(), code: z.string().trim().max(12) });

/** Teams are for young people (and only on links that include teams). */
function youthOnly(person: Person) {
  requireFeature(person, 'teams');
  if (person.kind === 'adult') throw conflict('Leaders can’t be on teams.');
}


/** Make a new team, with yourself on it. */
publicSignupRoutes.post('/team/create', async (c) => {
  const { pass, activityId, name, locked } = await parseBody(c, teamCreateSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  youthOnly(person);
  const te = await openTeamEvent(c, person, activityId);
  await notAlreadyOnATeam(c, activityId, person.registrationId);
  const teamId = await createTeam(c.env.DB, person.event.id, te, name, locked);
  try {
    await addMember(c.env.DB, person.event.id, { id: teamId, activity_id: activityId, name }, te, person.registrationId, 'self_signup');
  } catch (err) {
    await c.env.DB.prepare(`DELETE FROM teams WHERE id = ?`).bind(teamId).run();
    throw err;
  }
  await auditStatement(c.env.DB, { actor: { type: 'public' }, action: 'team.self_create', eventId: person.event.id, targetType: 'team', targetId: teamId, detail: { activityId, locked } }).run();
  return c.json(await personView(c, person));
});

publicSignupRoutes.post('/team/join', async (c) => {
  const { pass, teamId } = await parseBody(c, teamJoinSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  youthOnly(person);
  const team = await teamRow(c.env.DB, person.event.id, teamId);
  if (!team) throw notFound();
  if (team.locked === 1) throw conflict(`${team.name} is locked. Ask someone on it for the team code.`);
  const te = await openTeamEvent(c, person, team.activity_id);
  await notAlreadyOnATeam(c, team.activity_id, person.registrationId);
  await addMember(c.env.DB, person.event.id, team, te, person.registrationId, 'self_signup');
  await auditStatement(c.env.DB, {
    actor: { type: 'public' },
    action: 'team.self_join',
    eventId: person.event.id,
    targetType: 'registration',
    targetId: person.registrationId,
    detail: { teamId },
  }).run();
  return c.json(await personView(c, person));
});

/** Join a locked team with its code. */
publicSignupRoutes.post('/team/join-code', async (c) => {
  const { pass, activityId, code } = await parseBody(c, teamCodeSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  youthOnly(person);
  await limitPerKey(c, `team-code:${person.registrationId}`);
  const te = await openTeamEvent(c, person, activityId);
  const team = await c.env.DB.prepare(`SELECT id, activity_id, name FROM teams WHERE activity_id = ? AND event_id = ? AND join_code = ?`)
    .bind(activityId, person.event.id, code.replace(/\s+/g, '').toUpperCase())
    .first<{ id: string; activity_id: string; name: string }>();
  if (!team) throw conflict('That code doesn’t match a team. Check it with your friends.');
  await notAlreadyOnATeam(c, activityId, person.registrationId);
  await addMember(c.env.DB, person.event.id, team, te, person.registrationId, 'self_signup');
  await auditStatement(c.env.DB, { actor: { type: 'public' }, action: 'team.self_join', eventId: person.event.id, targetType: 'registration', targetId: person.registrationId, detail: { teamId: team.id, code: true } }).run();
  return c.json(await personView(c, person));
});

/** Leave your team. A team nobody is left on goes too. */
publicSignupRoutes.post('/team/leave', async (c) => {
  const { pass, teamId } = await parseBody(c, teamJoinSchema);
  await limitPublicNetwork(c, 'signup-book');
  const person = await personFor(c, await limitedPass(c, pass));
  requireFeature(person, 'teams');
  const team = await teamRow(c.env.DB, person.event.id, teamId);
  if (!team) throw notFound();
  await openTeamEvent(c, person, team.activity_id);
  if (await removeMember(c.env.DB, person.event.id, team.id, team.activity_id, person.registrationId, true)) {
    await auditStatement(c.env.DB, {
      actor: { type: 'public' },
      action: 'team.self_leave',
      eventId: person.event.id,
      targetType: 'registration',
      targetId: person.registrationId,
      detail: { teamId },
    }).run();
  }
  return c.json(await personView(c, person));
});

// ---------------------------------------------------------------- links for everyone (emailed before camp)

interface LinkRow {
  id: string;
  event_id: string;
  code: string;
  name: string;
  features: number;
  active: number;
  created_at: string;
}

async function linkByCode(c: AppContext, code: string): Promise<{ link: LinkRow; event: SignupEvent }> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(code)) throw notFound();
  const link = await c.env.DB.prepare(`SELECT * FROM participant_links WHERE code = ?`).bind(code).first<LinkRow>();
  if (!link || link.active !== 1) throw notFound();
  const e = await c.env.DB.prepare(
    `SELECT id, name, status, timezone, starts_on, ends_on, feature_self_signup, feature_side_quest, signup_code, section_settings, youth_sections, contact_email FROM events WHERE id = ?`,
  )
    .bind(link.event_id)
    .first<SignupEvent>();
  // Once the camp is over (or archived), its links stop.
  if (!e || (e.status !== 'open' && e.status !== 'draft')) throw notFound();
  return { link, event: e };
}

/** The page before a number is typed: the camp, and what the link lets people do. Nothing about anyone. */
publicSignupRoutes.get('/p/:code', async (c) => {
  const { link, event: e } = await linkByCode(c, c.req.param('code'));
  return c.json({
    event: { name: e.name, timezone: e.timezone, startsOn: e.starts_on, endsOn: e.ends_on, contactEmail: e.contact_email ?? '', banner: await bannerUrl(c.env.DB, e.id) },
    features: featuresOf(link.features),
  });
});

/**
 * Type a membership number and get your camp page, with just the parts the
 * link switches on. Anyone could type a number, so it's the reduced page (no
 * surname, group, duties, team-mates or dietary details) and typing is
 * limited per device.
 */
publicSignupRoutes.post('/p/:code', async (c) => {
  const { memberNumber } = await parseBody(c, z.strictObject({ memberNumber: z.string().trim().regex(/^[A-Za-z0-9 -]{1,24}$/, 'Type your membership number') }));
  await limitPublicNetwork(c, 'signup-identify');
  await limitPerKey(c, `link-book:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`, 'Too many tries. Wait a minute and try again.');
  const { link, event: e } = await linkByCode(c, c.req.param('code'));
  const who = await findByMemberNumber(c.env.DB, e.id, memberNumber);
  if (!who) throw conflict('That membership number isn’t registered for this camp. Check the number on your Scouts card or in MyScout.');
  const cred = await c.env.DB.prepare(`SELECT id FROM credentials WHERE registration_id = ? AND status = 'active'`).bind(who.id).first<{ id: string }>();
  if (!cred) throw conflict('Your camp page isn’t ready yet. Try again closer to camp, or ask your leader.');
  const person = await personFor(c, { registrationId: who.id, credentialId: cred.id, reduced: true, mask: link.features });
  return c.json(await personView(c, person));
});

/** Reopen a page from its pass (after a refresh), with the same parts on. */
publicSignupRoutes.post('/view', async (c) => {
  const { pass } = await parseBody(c, z.strictObject({ pass: z.string().max(200) }));
  await limitPublicNetwork(c, 'signup-identify');
  const p = await readPass(c, pass);
  // Only typed-number pages: someone's own lanyard page opens from its link.
  if (!p.reduced) throw new ApiError(401, 'signed_out', 'Scan your lanyard again to carry on.');
  return c.json(await personView(c, await personFor(c, p)));
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

/** Booking links (one per activity open for sign-up), for emailing before camp. Made on first use. */
signupRoutes.get('/signup/links', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  await c.env.DB.prepare(`UPDATE events SET booking_code = ? WHERE id = ? AND booking_code IS NULL`).bind(randomToken(12), eventId).run();
  const e = await c.env.DB.prepare(`SELECT booking_code, status, feature_self_signup FROM events WHERE id = ?`).bind(eventId).first<{ booking_code: string; status: string; feature_self_signup: number }>();
  if (!e) throw notFound();
  return c.json({ code: e.booking_code, selfSignup: e.feature_self_signup === 1, sessions: await sessions(c.env.DB, eventId) });
});

/** New booking links: the old ones stop working. */
signupRoutes.post('/signup/links/new', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE events SET booking_code = ? WHERE id = ?`).bind(randomToken(12), eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'signup.new_booking_links', eventId, targetType: 'event', targetId: eventId }),
  ]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- links for everyone (staff)

const linkDto = (c: AppContext, l: LinkRow) => ({
  id: l.id,
  name: l.name,
  features: featuresOf(l.features),
  active: l.active === 1,
  url: `${new URL(c.req.url).origin}/p/${l.code}`,
  createdAt: l.created_at,
});

signupRoutes.get('/participant-links', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const { results } = await c.env.DB.prepare(`SELECT * FROM participant_links WHERE event_id = ? ORDER BY created_at`).bind(eventId).all<LinkRow>();
  return c.json({ links: results.map((l) => linkDto(c, l)) });
});

signupRoutes.post('/participant-links', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, participantLinkSchema);
  const count = await c.env.DB.prepare(`SELECT count(*) AS n FROM participant_links WHERE event_id = ?`).bind(eventId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 20) throw conflict('A camp can have up to 20 links. Delete one you no longer use.');
  const now = nowIso();
  const row: LinkRow = { id: crypto.randomUUID(), event_id: eventId, code: randomToken(12), name: input.name, features: maskOf(input.features), active: 1, created_at: now };
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO participant_links (id, event_id, code, name, features, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).bind(
      row.id,
      eventId,
      row.code,
      row.name,
      row.features,
      now,
      now,
    ),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'participant_link.create', eventId, targetType: 'participant_link', targetId: row.id, detail: { name: row.name, features: input.features.join(',') } }),
  ]);
  return c.json({ link: linkDto(c, row) }, 201);
});

async function ownLink(c: AppContext, eventId: string): Promise<LinkRow> {
  const l = await c.env.DB.prepare(`SELECT * FROM participant_links WHERE id = ? AND event_id = ?`).bind(c.req.param('linkId'), eventId).first<LinkRow>();
  if (!l) throw notFound();
  return l;
}

signupRoutes.patch('/participant-links/:linkId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const input = await parseBody(c, participantLinkPatchSchema);
  const l = await ownLink(c, eventId);
  const next: LinkRow = {
    ...l,
    name: input.name ?? l.name,
    features: input.features ? maskOf(input.features) : l.features,
    active: input.active === undefined ? l.active : input.active ? 1 : 0,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE participant_links SET name = ?, features = ?, active = ?, updated_at = ? WHERE id = ?`).bind(next.name, next.features, next.active, nowIso(), l.id),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'participant_link.update', eventId, targetType: 'participant_link', targetId: l.id, detail: { name: next.name, features: featuresOf(next.features).join(','), active: next.active === 1 } }),
  ]);
  return c.json({ link: linkDto(c, next) });
});

/** A new address for a link: the old one stops working. */
signupRoutes.post('/participant-links/:linkId/new-code', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const l = await ownLink(c, eventId);
  const code = randomToken(12);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE participant_links SET code = ?, updated_at = ? WHERE id = ?`).bind(code, nowIso(), l.id),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'participant_link.new_code', eventId, targetType: 'participant_link', targetId: l.id }),
  ]);
  return c.json({ link: linkDto(c, { ...l, code }) });
});

signupRoutes.delete('/participant-links/:linkId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'activities.manage', { eventId });
  const user = requireUser(c);
  const l = await ownLink(c, eventId);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM participant_links WHERE id = ?`).bind(l.id),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'participant_link.delete', eventId, targetType: 'participant_link', targetId: l.id, detail: { name: l.name } }),
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
 * Move someone's booking from this activity to another (another session of
 * the same thing, or something else entirely): one step, so they're never
 * left with no booking or two. Like other staff bookings it ignores the
 * capacity limit. Needs booking rights on both activities.
 */
signupRoutes.post('/activities/:activityId/bookings/:registrationId/move', async (c) => {
  const eventId = c.req.param('eventId')!;
  const from = c.req.param('activityId');
  const registrationId = c.req.param('registrationId');
  const { to } = await parseBody(c, z.strictObject({ to: z.uuid() }));
  requireBookings(c, eventId, from);
  requireBookings(c, eventId, to);
  const user = requireUser(c);
  if (to === from) throw badRequest('Choose a different activity.');
  const ok = await c.env.DB.prepare(
    `SELECT a.name FROM activities a, registrations r, activity_bookings b
      WHERE a.id = ? AND a.event_id = ? AND a.status = 'active'
        AND r.id = ? AND r.event_id = ? AND r.status = 'active'
        AND b.activity_id = ? AND b.registration_id = r.id`,
  )
    .bind(to, eventId, registrationId, eventId, from)
    .first<{ name: string }>();
  if (!ok) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM activity_bookings WHERE activity_id = ? AND registration_id = ? AND event_id = ?`).bind(from, registrationId, eventId),
    c.env.DB.prepare(
      `INSERT INTO activity_bookings (activity_id, registration_id, event_id, source, created_at) VALUES (?, ?, ?, 'manual', ?)
       ON CONFLICT (activity_id, registration_id) DO NOTHING`,
    ).bind(to, registrationId, eventId, nowIso()),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'booking.move', eventId, targetType: 'registration', targetId: registrationId, detail: { from, to } }),
  ]);
  return c.json({ ok: true, to: { id: to, name: ok.name } });
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
    c.env.DB.prepare(
      `SELECT name, location, instructions, starts_at, ends_at, capacity, capacity_policy, track_sign_out, signup_open, booking_required, status,
              EXISTS (SELECT 1 FROM team_events t WHERE t.activity_id = activities.id) AS team_event
         FROM activities WHERE id = ?`,
    )
      .bind(activityId.data)
      .first<Record<string, string | number | null>>(),
    c.env.DB.prepare(
      `SELECT r.id, p.first_name, p.preferred_name, p.last_name, r.group_name, r.section, r.kind, r.photo_consent,
              json_extract(r.extra_fields, '$."Swimming ability"') AS swimming
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
      // From Consent2Go: useful for leaders of water activities.
      ...(p.swimming ? { swimming: p.swimming } : {}),
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
      capacityPolicy: activity!.capacity_policy,
      trackSignOut: activity!.track_sign_out === 1,
      signupOpen: activity!.signup_open === 1,
      bookingRequired: activity!.booking_required === 1,
      teamEvent: activity!.team_event === 1,
      status: activity!.status,
    },
    presentNow: state.presentNow,
    canBook: can(principal, 'activities.manage', { eventId }) || can(principal, 'activity.bookings', { eventId, activityId: activityId.data }),
    canCheckIn: can(principal, 'activity.scan', { eventId, activityId: activityId.data }),
    people: [...involved].filter((id) => byId.has(id)).map(row),
    everyone: people.results.map((p) => ({ id: p.id, name: `${p.preferred_name || p.first_name} ${p.last_name}`, groupName: p.group_name })),
  });
});

/**
 * Undo someone's check-ins at this activity, so they're back in "To come".
 * Scans are never changed or deleted: each one gets a void correction, like
 * "Undo this scan" on the person page. Activity leaders can do this for their
 * own activity; the audit log records who did it.
 */
signupRoutes.post('/activities/:activityId/attendance/:registrationId/reset', async (c) => {
  const eventId = c.req.param('eventId')!;
  const activityId = z.uuid().safeParse(c.req.param('activityId'));
  const registrationId = z.uuid().safeParse(c.req.param('registrationId'));
  if (!activityId.success || !registrationId.success) throw notFound();
  const principal = requirePermission(c, 'activity.scan', { eventId, activityId: activityId.data });
  const user = requireUser(c);
  const event = await c.env.DB.prepare(`SELECT status FROM events WHERE id = ?`).bind(eventId).first<{ status: string }>();
  if (!event) throw notFound();
  if (event.status !== 'open') throw conflict('Check-ins can only be changed while the event is open.');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.direction FROM scans s
      WHERE s.event_id = ? AND s.context_type = 'activity' AND s.context_id = ? AND s.registration_id = ?
        AND s.outcome IN ('accepted', 'duplicate', 'review')
        AND NOT EXISTS (SELECT 1 FROM scans c WHERE c.supersedes_id = s.id)`,
  )
    .bind(eventId, activityId.data, registrationId.data)
    .all<{ id: string; direction: string }>();
  if (results.length === 0) return c.json({ undone: 0 });
  const now = nowIso();
  await c.env.DB.batch([
    ...results.map((s) =>
      c.env.DB.prepare(
        `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time,
            device_id, actor_user_id, outcome, supersedes_id, correction_reason)
         VALUES (?, ?, 'activity', ?, ?, ?, 'correction', ?, ?, 'server', ?, 'void', ?, 'Moved back to To come')`,
      ).bind(crypto.randomUUID(), eventId, activityId.data, registrationId.data, s.direction, now, now, user.userId, s.id),
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'attendance.reset',
      eventId,
      targetType: 'activity',
      targetId: activityId.data,
      detail: { scans: results.length, via: can(principal, 'attendance.correct', { eventId }) ? 'manager' : 'leader' },
    }),
  ]);
  return c.json({ undone: results.length });
});
