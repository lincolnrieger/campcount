import { displayName } from '../../shared/names';
import { conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';

/**
 * Team events (Soccer, Basketball…). Each one is an activity with team
 * settings, so it is scheduled, scanned and led like any activity. Being on
 * a team books the person onto that activity, which is what its scanner and
 * leader see as "booked".
 */

export interface TeamEventRow {
  activity_id: string;
  name: string;
  description: string;
  location: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  min_size: number;
  max_size: number | null;
  max_teams: number | null;
  registration_open: number;
}

export interface TeamMember {
  registrationId: string;
  name: string;
  groupName: string;
  section: string;
  source: 'manual' | 'self_signup';
}

export interface TeamDto {
  id: string;
  name: string;
  members: TeamMember[];
}

export interface TeamEventDto {
  id: string;
  name: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  minSize: number;
  maxSize: number | null;
  maxTeams: number | null;
  registrationOpen: boolean;
  teams: TeamDto[];
}

const TEAM_EVENT_SELECT = `SELECT t.activity_id, a.name, a.description, a.location, a.starts_at, a.ends_at, a.status,
       t.min_size, t.max_size, t.max_teams, t.registration_open
  FROM team_events t JOIN activities a ON a.id = t.activity_id`;

/** Team events with their teams and members. `only` limits it to some activities (an activity leader's). */
export async function loadTeamEvents(db: D1Database, eventId: string, only?: Set<string> | 'all'): Promise<TeamEventDto[]> {
  const [events, teams, members] = await Promise.all([
    db
      .prepare(`${TEAM_EVENT_SELECT} WHERE t.event_id = ? ORDER BY a.starts_at IS NULL, a.starts_at, a.name COLLATE NOCASE`)
      .bind(eventId)
      .all<TeamEventRow>(),
    db.prepare(`SELECT id, activity_id, name FROM teams WHERE event_id = ? ORDER BY created_at`).bind(eventId).all<{ id: string; activity_id: string; name: string }>(),
    db
      .prepare(
        `SELECT m.team_id, m.registration_id, m.source, p.first_name, p.preferred_name, p.last_name, r.group_name, r.section, r.kind
           FROM team_members m JOIN registrations r ON r.id = m.registration_id JOIN people p ON p.id = r.person_id
          WHERE m.event_id = ? ORDER BY m.joined_at`,
      )
      .bind(eventId)
      .all<Record<string, string>>(),
  ]);
  const byTeam = new Map<string, TeamMember[]>();
  for (const m of members.results) {
    const list = byTeam.get(m.team_id!) ?? [];
    list.push({
      registrationId: m.registration_id!,
      name: displayName(m.first_name!, m.preferred_name!, m.last_name!),
      groupName: m.group_name!,
      section: m.kind === 'adult' ? 'Leader' : m.section!,
      source: m.source as TeamMember['source'],
    });
    byTeam.set(m.team_id!, list);
  }
  return events.results
    .filter((e) => !only || only === 'all' || only.has(e.activity_id))
    .map((e) => ({
      id: e.activity_id,
      name: e.name,
      description: e.description,
      location: e.location,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      status: e.status,
      minSize: e.min_size,
      maxSize: e.max_size,
      maxTeams: e.max_teams,
      registrationOpen: e.registration_open === 1,
      teams: teams.results.filter((t) => t.activity_id === e.activity_id).map((t) => ({ id: t.id, name: t.name, members: byTeam.get(t.id) ?? [] })),
    }));
}

export async function teamEventRow(db: D1Database, eventId: string, activityId: string): Promise<TeamEventRow | null> {
  return db.prepare(`${TEAM_EVENT_SELECT} WHERE t.event_id = ? AND t.activity_id = ?`).bind(eventId, activityId).first<TeamEventRow>();
}

export async function teamRow(db: D1Database, eventId: string, teamId: string) {
  return db.prepare(`SELECT id, activity_id, name FROM teams WHERE id = ? AND event_id = ?`).bind(teamId, eventId).first<{ id: string; activity_id: string; name: string }>();
}

/** Make a team. Checks the event's team limit and that the name is free. */
export async function createTeam(db: D1Database, eventId: string, te: TeamEventRow, name: string): Promise<string> {
  const id = crypto.randomUUID();
  const taken = await db.prepare(`SELECT 1 FROM teams WHERE activity_id = ? AND name = ? COLLATE NOCASE`).bind(te.activity_id, name).first();
  if (taken) throw conflict(`There's already a team called ${name}. Choose another name.`);
  const res = await db
    .prepare(
      `INSERT INTO teams (id, event_id, activity_id, name, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5 WHERE ?6 IS NULL OR (SELECT count(*) FROM teams WHERE activity_id = ?3) < ?6`,
    )
    .bind(id, eventId, te.activity_id, name, nowIso(), te.max_teams)
    .run();
  if (res.meta.changes !== 1) throw conflict(`${te.name} already has ${te.max_teams} teams, the most allowed.`);
  return id;
}

/**
 * Put someone on a team (and book them onto the activity). Moves them if
 * they're on another team for the same event. Refused if the team is full.
 */
export async function addMember(
  db: D1Database,
  eventId: string,
  team: { id: string; activity_id: string; name: string },
  te: TeamEventRow,
  registrationId: string,
  source: 'manual' | 'self_signup',
): Promise<void> {
  const reg = await db.prepare(`SELECT 1 FROM registrations WHERE id = ? AND event_id = ? AND status = 'active'`).bind(registrationId, eventId).first();
  if (!reg) throw notFound();
  const already = await db
    .prepare(`SELECT team_id FROM team_members WHERE activity_id = ? AND registration_id = ?`)
    .bind(te.activity_id, registrationId)
    .first<{ team_id: string }>();
  if (already?.team_id === team.id) return;
  const now = nowIso();
  const results = await db.batch([
    db.prepare(`DELETE FROM team_members WHERE activity_id = ? AND registration_id = ?`).bind(te.activity_id, registrationId),
    // Atomic: only joins if there's still room.
    db
      .prepare(
        `INSERT INTO team_members (team_id, activity_id, registration_id, event_id, source, joined_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE ?7 IS NULL OR (SELECT count(*) FROM team_members WHERE team_id = ?1) < ?7`,
      )
      .bind(team.id, te.activity_id, registrationId, eventId, source, now, te.max_size),
    db
      .prepare(
        `INSERT INTO activity_bookings (activity_id, registration_id, event_id, source, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM team_members WHERE activity_id = ?1 AND registration_id = ?2)
         ON CONFLICT (activity_id, registration_id) DO NOTHING`,
      )
      .bind(te.activity_id, registrationId, eventId, source, now),
  ]);
  if (results[1]!.meta.changes !== 1) {
    // Full: put them back where they were.
    if (already) {
      await db
        .prepare(`INSERT INTO team_members (team_id, activity_id, registration_id, event_id, source, joined_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(already.team_id, te.activity_id, registrationId, eventId, source, now)
        .run();
    }
    throw conflict(`${team.name} is full (${te.max_size} people).`);
  }
}

/** Take someone off a team, and off the activity's bookings. A team left with nobody can be removed too. */
export async function removeMember(db: D1Database, eventId: string, teamId: string, activityId: string, registrationId: string, dropEmptyTeam: boolean): Promise<boolean> {
  const results = await db.batch([
    db.prepare(`DELETE FROM team_members WHERE team_id = ? AND registration_id = ? AND event_id = ?`).bind(teamId, registrationId, eventId),
    db.prepare(`DELETE FROM activity_bookings WHERE activity_id = ? AND registration_id = ? AND event_id = ?`).bind(activityId, registrationId, eventId),
    ...(dropEmptyTeam ? [db.prepare(`DELETE FROM teams WHERE id = ? AND NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = ?)`).bind(teamId, teamId)] : []),
  ]);
  return results[0]!.meta.changes === 1;
}

/** Delete a team: its members come off the activity's bookings too. */
export function deleteTeamStatements(db: D1Database, eventId: string, teamId: string, activityId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM activity_bookings WHERE activity_id = ? AND event_id = ? AND registration_id IN (SELECT registration_id FROM team_members WHERE team_id = ?)`)
      .bind(activityId, eventId, teamId),
    db.prepare(`DELETE FROM teams WHERE id = ? AND event_id = ?`).bind(teamId, eventId),
  ];
}

/** What a participant sees: every team event, the teams in it (no other people's names) and their own team. */
export async function participantTeams(db: D1Database, eventId: string, registrationId: string) {
  const all = await loadTeamEvents(db, eventId);
  return all
    .filter((e) => e.status === 'active')
    .map((e) => {
      const mine = e.teams.find((t) => t.members.some((m) => m.registrationId === registrationId)) ?? null;
      return {
        id: e.id,
        name: e.name,
        location: e.location,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        minSize: e.minSize,
        maxSize: e.maxSize,
        open: e.registrationOpen,
        canMakeTeam: e.registrationOpen && !mine && (e.maxTeams === null || e.teams.length < e.maxTeams),
        myTeam: mine ? { id: mine.id, name: mine.name, members: mine.members.map((m) => m.name) } : null,
        teams: e.teams.map((t) => ({ id: t.id, name: t.name, size: t.members.length, full: e.maxSize !== null && t.members.length >= e.maxSize })),
      };
    });
}
