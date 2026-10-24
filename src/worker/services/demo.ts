import type { Env } from '../env';
import { randomInt } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { auditStatement } from './audit';
import { issueStatements } from './credentials';
import { eventDays, todayInZone, weekdayName, zonedIso } from '../../shared/time';

/** Demo events use the default event timezone. */
const DEMO_TZ = 'Australia/Adelaide';

/**
 * Demo data for testing CampCount end to end without real member data.
 * Everything here is invented. Demo membership numbers start with "DEMO",
 * which real Scouts membership numbers never do, and demo accounts use the
 * reserved .invalid domain, so no email can ever be sent to them.
 */

const FIRST = [
  'Ava', 'Noah', 'Mia', 'Leo', 'Isla', 'Kai', 'Zoe', 'Eli', 'Ruby', 'Max', 'Ivy', 'Sam', 'Ella', 'Finn', 'Lily', 'Jack', 'Nina',
  'Theo', 'Aria', 'Oscar', 'Maya', 'Hugo', 'Chloe', 'Arlo', 'Willow', 'Harvey', 'Matilda', 'Archie', 'Evie', 'Ned', 'Poppy',
  'Ollie', 'Frankie', 'Jasper', 'Indie', 'Remy', 'Sienna', 'Banjo', 'Tilly', 'Beau',
];
const LAST = [
  'Nguyen', 'Smith', 'Patel', 'Brown', 'Wilson', 'Taylor', 'Lee', 'Martin', 'Clarke', 'Walker', 'Chen', 'Kelly', 'Rossi',
  'Murphy', 'Singh', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Hill', 'Campbell', 'Mitchell',
];
const GROUPS: { name: string; section: 'Joeys' | 'Cubs' | 'Scouts' | 'Venturers' }[] = [
  { name: 'Wattle Creek Joey Mob', section: 'Joeys' },
  { name: 'Wattle Creek Cub Pack', section: 'Cubs' },
  { name: 'Red Gum Cub Pack', section: 'Cubs' },
  { name: 'Red Gum Scout Troop', section: 'Scouts' },
  { name: 'Saltbush Scout Troop', section: 'Scouts' },
  { name: 'Saltbush Venturer Unit', section: 'Venturers' },
];
const DIETARY: [string, string, string][] = [
  ['preference', 'Vegetarian', 'standard'],
  ['preference', 'Vegetarian', 'standard'],
  ['religious_cultural', 'Halal', 'standard'],
  ['medical_diet', 'Gluten free (coeliac)', 'standard'],
  ['intolerance', 'Lactose', 'standard'],
  ['allergy', 'Peanut', 'anaphylactic'],
  ['allergy', 'Egg', 'standard'],
];

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]!;

export const DEMO_ROLES = [
  { key: 'event_manager', label: 'Event manager' },
  { key: 'scanner', label: 'Scanner' },
  { key: 'activity_leader', label: 'Activity leader' },
  { key: 'meal_leader', label: 'Meal team' },
] as const;

export async function createDemoEvent(env: Env, adminUserId: string, participants: number): Promise<{ eventId: string }> {
  const now = nowIso();
  const tag = crypto.randomUUID().slice(0, 4).toUpperCase();
  const eventId = crypto.randomUUID();
  const today = todayInZone(DEMO_TZ);
  const end = new Date(Date.parse(today) + 2 * 86400_000).toISOString().slice(0, 10);
  const db = env.DB;
  const statements: D1PreparedStatement[] = [];

  statements.push(
    db
      .prepare(
        `INSERT INTO events (id, slug, name, description, location, starts_on, ends_on, status, feature_activities, feature_meals,
           feature_site, feature_dietary, feature_photo, feature_self_signup, is_demo, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Demo Activity Centre', ?, ?, 'open', 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)`,
      )
      .bind(
        eventId,
        `demo-${tag.toLowerCase()}-${today}`,
        `Demo camp ${tag}`,
        'Demo event with invented people, for testing. Safe to delete.',
        today,
        end,
        adminUserId,
        now,
        now,
      ),
  );

  // Activities and meals.
  const activities = [
    { name: 'Kayaking', location: 'Lake', capacity: 12, trackSignOut: 1 },
    { name: 'Archery', location: 'Range', capacity: 10, trackSignOut: 1 },
    { name: 'Climbing wall', location: 'Tower', capacity: 8, trackSignOut: 1 },
    { name: 'Campfire craft', location: 'Hall', capacity: null, trackSignOut: 0 },
  ].map((a) => ({ ...a, id: crypto.randomUUID(), startsAt: null as string | null, endsAt: null as string | null }));
  // Sessions with set times, across the camp days.
  const sessionDays = eventDays(today, new Date(Date.parse(today) + 2 * 86400_000).toISOString().slice(0, 10));
  for (const [d, start, end] of [
    [0, '13:00', '14:30'],
    [0, '15:00', '16:30'],
    [1, '09:00', '10:30'],
    [1, '11:00', '12:30'],
  ] as const) {
    activities.push({
      name: 'Raft building',
      location: 'Creek',
      capacity: 10,
      trackSignOut: 1,
      id: crypto.randomUUID(),
      startsAt: zonedIso(sessionDays[d]!, start, DEMO_TZ),
      endsAt: zonedIso(sessionDays[d]!, end, DEMO_TZ),
    });
  }
  for (const a of activities) {
    statements.push(
      db
        .prepare(
          `INSERT INTO activities (id, event_id, name, location, capacity, track_sign_out, starts_at, ends_at, signup_open, booking_required, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        // Timed sessions are open for sign-up, so the sign-up screen has something to show.
        .bind(a.id, eventId, a.name, a.location, a.capacity, a.trackSignOut, a.startsAt, a.endsAt, a.startsAt ? 1 : 0, a.startsAt ? 1 : 0, now, now),
    );
  }
  // Meals across the three days, timed in the event's timezone.
  const days = eventDays(today, end);
  const meals: [number, string, string][] = [
    [0, 'dinner', '18:00'],
    [1, 'breakfast', '07:30'],
    [1, 'lunch', '12:30'],
    [1, 'dinner', '18:00'],
    [2, 'breakfast', '07:30'],
    [2, 'lunch', '12:30'],
  ];
  const mealRows = meals.map(([d, meal, time]) => ({ id: crypto.randomUUID(), name: `${weekdayName(days[d]!)} ${meal}`, startsAt: zonedIso(days[d]!, time, DEMO_TZ) }));
  for (const m of mealRows) {
    statements.push(
      db
        .prepare(`INSERT INTO meal_services (id, event_id, name, starts_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(m.id, eventId, m.name, m.startsAt, now, now),
    );
  }

  // People: youth across groups, plus a leader team.
  const registrationIds: string[] = [];
  const adults = Math.max(4, Math.round(participants / 8));
  for (let i = 0; i < participants + adults; i++) {
    const adult = i >= participants;
    const group = pick(GROUPS);
    const personId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const member = `DEMO${tag}-${String(i + 1).padStart(3, '0')}`;
    registrationIds.push(registrationId);
    statements.push(
      db
        .prepare(`INSERT INTO people (id, member_number, first_name, preferred_name, last_name, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)`)
        .bind(personId, member, pick(FIRST), pick(LAST), now, now),
      db
        .prepare(
          `INSERT INTO registrations (id, event_id, person_id, kind, section, group_name, position, role_label, photo_consent, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          registrationId,
          eventId,
          personId,
          adult ? 'adult' : 'youth',
          adult ? 'Leaders' : group.section,
          group.name,
          adult ? 'Leader' : `${group.section.replace(/s$/, '')} member`,
          adult ? 'Leader' : 'Participant',
          randomInt(10) < 8 ? 'yes' : randomInt(2) ? 'no' : 'unknown',
          now,
          now,
        ),
    );
    if (randomInt(100) < 18) {
      const [category, item, severity] = pick(DIETARY);
      statements.push(
        db
          .prepare(
            `INSERT INTO dietary_entries (id, event_id, registration_id, category, item, severity, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), eventId, registrationId, category, item, severity, adminUserId, now),
      );
    }
  }

  // Demo staff accounts (cannot receive email: the .invalid domain is reserved).
  for (const role of DEMO_ROLES) {
    const userId = crypto.randomUUID();
    statements.push(
      db
        .prepare(`INSERT INTO users (id, email, display_name, is_demo, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
        .bind(userId, `demo-${role.key.replace(/_/g, '-')}-${tag.toLowerCase()}@demo.invalid`, `Demo ${role.label}`, now, now),
      db
        .prepare(`INSERT INTO assignments (id, user_id, role_id, event_id, activity_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        // The demo activity leader runs Kayaking.
        .bind(crypto.randomUUID(), userId, `role_${role.key}`, eventId, role.key === 'activity_leader' ? activities.find((a) => a.name === 'Kayaking')!.id : null, adminUserId, now),
    );
  }
  // The admin manages their own demo camp, so they can try every screen.
  statements.push(
    db
      .prepare(`INSERT INTO assignments (id, user_id, role_id, event_id, created_by, created_at) VALUES (?, ?, 'role_event_manager', ?, ?, ?)`)
      .bind(crypto.randomUUID(), adminUserId, eventId, adminUserId, now),
    auditStatement(db, {
      actor: { type: 'user', id: adminUserId },
      action: 'demo.create',
      eventId,
      targetType: 'event',
      targetId: eventId,
      detail: { participants, adults },
    }),
  );

  statements.push(...demoScans(db, eventId, adminUserId, registrationIds, activities, mealRows));

  for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80));
  const cards = await issueStatements(env, eventId, registrationIds);
  for (let i = 0; i < cards.length; i += 80) await db.batch(cards.slice(i, i + 80));
  return { eventId };
}

/**
 * A morning's worth of made-up scans, so the live board and people pages
 * have something to show: most people arrived at the gate a few hours ago,
 * a few have left, some are at activities now, and any meal that has
 * already started has been served.
 */
function demoScans(
  db: D1Database,
  eventId: string,
  actorId: string,
  registrationIds: string[],
  activities: { id: string; trackSignOut: number; capacity: number | null; startsAt: string | null; endsAt: string | null }[],
  meals: { id: string; startsAt: string }[],
): D1PreparedStatement[] {
  const nowMs = Date.now();
  const ago = (minMinutes: number, maxMinutes: number) => new Date(nowMs - (minMinutes + randomInt(maxMinutes - minMinutes + 1)) * 60_000).toISOString();
  const statements: D1PreparedStatement[] = [];
  const scan = (contextType: string, contextId: string | null, registrationId: string, direction: 'in' | 'out', at: string) =>
    statements.push(
      db
        .prepare(
          `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time, device_id, actor_user_id, outcome)
           VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, 'demo-seed', ?, 'accepted')`,
        )
        .bind(crypto.randomUUID(), eventId, contextType, contextId, registrationId, direction, at, at, actorId),
    );
  const arrived = registrationIds.filter(() => randomInt(100) < 88);
  const here: string[] = [];
  for (const id of arrived) {
    scan('site', null, id, 'in', ago(150, 300));
    if (randomInt(100) < 7) scan('site', null, id, 'out', ago(10, 120));
    else here.push(id);
  }
  // Earlier sessions that have finished, then who is at each activity now.
  // Only all-camp activities and sessions running now have people in them.
  const tracked = activities.filter((a) => a.trackSignOut === 1 && (!a.startsAt || (Date.parse(a.startsAt) <= nowMs && nowMs <= Date.parse(a.endsAt!))));
  const pool = [...here];
  for (const a of tracked) {
    for (let i = 0; i < 4 && pool.length; i++) {
      const id = pool[randomInt(pool.length)]!;
      scan('activity', a.id, id, 'in', ago(100, 140));
      scan('activity', a.id, id, 'out', ago(65, 95));
    }
    const now = Math.min(pool.length, Math.max(2, Math.round((a.capacity ?? 8) * (0.5 + randomInt(50) / 100))));
    for (let i = 0; i < now; i++) {
      const id = pool.splice(randomInt(pool.length), 1)[0]!;
      scan('activity', a.id, id, 'in', ago(5, 55));
    }
  }
  for (const a of activities.filter((x) => x.trackSignOut === 0)) {
    for (let i = 0; i < 10 && here.length; i++) scan('activity', a.id, here[randomInt(here.length)]!, 'in', ago(30, 200));
  }
  for (const m of meals.filter((x) => Date.parse(x.startsAt) <= nowMs)) {
    const startedMinutes = Math.floor((nowMs - Date.parse(m.startsAt)) / 60_000);
    for (const id of here) if (randomInt(100) < 85) scan('meal', m.id, id, 'in', ago(Math.max(0, startedMinutes - 40), Math.max(1, startedMinutes)));
  }
  return statements;
}

/** Delete a demo event and everything in it, including its demo accounts and invented people. */
export async function deleteDemoEvent(env: Env, adminUserId: string, eventId: string): Promise<boolean> {
  const db = env.DB;
  const event = await db.prepare(`SELECT id FROM events WHERE id = ? AND is_demo = 1`).bind(eventId).first();
  if (!event) return false;
  const people = await db.prepare(`SELECT person_id AS id FROM registrations WHERE event_id = ?`).bind(eventId).all<{ id: string }>();
  const users = await db
    .prepare(`SELECT DISTINCT a.user_id AS id FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? AND u.is_demo = 1`)
    .bind(eventId)
    .all<{ id: string }>();

  const statements: D1PreparedStatement[] = [
    // Corrections reference the scans they replace, so remove them first.
    db.prepare(`DELETE FROM scans WHERE event_id = ? AND supersedes_id IS NOT NULL`).bind(eventId),
    db.prepare(`DELETE FROM scans WHERE event_id = ?`).bind(eventId),
    db.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId),
  ];
  const chunks = <T>(list: T[], size = 90) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
  for (const chunk of chunks(people.results.map((p) => p.id))) {
    statements.push(
      db
        .prepare(
          `DELETE FROM people WHERE id IN (${chunk.map(() => '?').join(',')}) AND member_number LIKE 'DEMO%'
             AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.person_id = people.id)`,
        )
        .bind(...chunk),
    );
  }
  for (const chunk of chunks(users.results.map((u) => u.id))) {
    statements.push(
      db
        .prepare(
          `DELETE FROM users WHERE id IN (${chunk.map(() => '?').join(',')}) AND is_demo = 1
             AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = users.id)`,
        )
        .bind(...chunk),
    );
  }
  statements.push(
    auditStatement(db, { actor: { type: 'user', id: adminUserId }, action: 'demo.delete', eventId, targetType: 'event', targetId: eventId }),
  );
  await db.batch(statements);
  return true;
}
