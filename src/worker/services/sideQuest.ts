import { loadSections } from './sections';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../context';
import { hmacHex, timingSafeEqualHex } from '../lib/crypto';
import { nowIso } from '../lib/time';

/**
 * Super Splash Side Quest: a secret game. A phone that has opened its own
 * lanyard link remembers who it belongs to (a signed, HttpOnly cookie).
 * When that phone opens someone else's lanyard link (scanning their QR with
 * the camera), it collects them instead of showing their page.
 *
 * Only counts and first names are ever shown to participants. Who collected
 * whom is purged with the camp's other sensitive data after 90 days.
 */

export const ME_COOKIE = '__Host-cc_me';
const ME_DAYS = 60;

export interface Me {
  registrationId: string;
  credentialId: string;
}

async function sign(c: AppContext, me: Me) {
  return hmacHex(c.env.AUTH_SECRET, `me:${me.registrationId}.${me.credentialId}`);
}

/** Who this phone belongs to, if it has opened its own lanyard link. Only the signature is checked here. */
export async function readMe(c: AppContext): Promise<Me | null> {
  const raw = getCookie(c, ME_COOKIE);
  if (!raw) return null;
  const [registrationId, credentialId, mac] = raw.split('.');
  if (!registrationId || !credentialId || !mac) return null;
  if (!timingSafeEqualHex(mac, await sign(c, { registrationId, credentialId }))) return null;
  return { registrationId, credentialId };
}

/** Remember whose phone this is: until two days after the camp ends (at most 60 days), not for good. */
export async function writeMe(c: AppContext, me: Me, endsOn?: string) {
  const untilEnd = endsOn ? Math.floor((Date.parse(`${endsOn}T00:00:00Z`) + 2 * 86_400_000 - Date.now()) / 1000) : ME_DAYS * 86_400;
  setCookie(c, ME_COOKIE, `${me.registrationId}.${me.credentialId}.${await sign(c, me)}`, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: Math.max(3600, Math.min(ME_DAYS * 86_400, untilEnd)),
  });
}

/** Is this phone's owner still a live participant at this camp (card not replaced, not withdrawn)? */
export async function meIsValid(db: D1Database, me: Me, eventId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM registrations r JOIN credentials cr ON cr.registration_id = r.id
        WHERE r.id = ? AND r.event_id = ? AND r.status = 'active' AND cr.id = ? AND cr.status = 'active'`,
    )
    .bind(me.registrationId, eventId, me.credentialId)
    .first();
  return !!row;
}

/** Record a collection. Returns false if they'd already collected this person. */
export async function collect(db: D1Database, eventId: string, collectorId: string, collectedId: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO side_quest_collections (event_id, collector_id, collected_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (collector_id, collected_id) DO NOTHING`,
    )
    .bind(eventId, collectorId, collectedId, nowIso())
    .run();
  return res.meta.changes === 1;
}

export interface Quest {
  key: string;
  label: string;
  collected: number;
  total: number;
  done: boolean;
}

export interface Standing {
  collected: number;
  /** Everyone else on the camp who could be collected. */
  total: number;
  /** 1 = top. Ties share a place. Null until they've collected someone. */
  rank: number | null;
  players: number;
  /** The top three and the people either side of them, by first name and initial only. */
  board: { place: number; name: string; collected: number; isYou: boolean }[];
  quests: Quest[];
}

const shortName = (first: string, preferred: string, last: string) => `${(preferred || first).trim()} ${last.trim().charAt(0)}${last.trim() ? '.' : ''}`.trim();

/** Where someone stands in the side quest. */
export async function standing(db: D1Database, eventId: string, registrationId: string): Promise<Standing> {
  const [people, mine, counts] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.kind, r.section, p.first_name, p.preferred_name, p.last_name FROM registrations r JOIN people p ON p.id = r.person_id
          WHERE r.event_id = ? AND r.status = 'active' AND r.kind = 'youth'`,
      )
      .bind(eventId)
      .all<{ id: string; kind: string; section: string; first_name: string; preferred_name: string; last_name: string }>(),
    db.prepare(`SELECT collected_id FROM side_quest_collections WHERE collector_id = ?`).bind(registrationId).all<{ collected_id: string }>(),
    db
      .prepare(
        `SELECT c.collector_id, count(*) AS n FROM side_quest_collections c
           JOIN registrations b ON b.id = c.collected_id AND b.kind = 'youth' AND b.status = 'active'
          WHERE c.event_id = ? GROUP BY c.collector_id`,
      )
      .bind(eventId)
      .all<{ collector_id: string; n: number }>(),
  ]);
  const byId = new Map(people.results.map((p) => [p.id, p]));
  const got = new Set(mine.results.map((r) => r.collected_id).filter((id) => byId.has(id)));
  const others = people.results.filter((p) => p.id !== registrationId);

  // Quests: everyone in each youth section. Only young people play.
  const sections = await loadSections(db, eventId);
  const groupOf = (p: { kind: string; section: string }) => p.section.toLowerCase();
  const quests: Quest[] = [];
  const keys = sections.filter((s) => s.youth && s.base !== 'Other').map((s) => ({ key: s.name.toLowerCase(), label: s.name }));
  for (const { key, label } of keys) {
    const inGroup = others.filter((p) => groupOf(p) === key);
    if (inGroup.length === 0) continue;
    const n = inGroup.filter((p) => got.has(p.id)).length;
    quests.push({ key, label, collected: n, total: inGroup.length, done: n === inGroup.length });
  }

  // Rank by how many each player has collected; ties share a place.
  const table = counts.results
    .filter((r) => byId.has(r.collector_id))
    .map((r) => ({ id: r.collector_id, n: r.n }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const placeOf = (n: number) => 1 + table.filter((r) => r.n > n).length;
  const myIndex = table.findIndex((r) => r.id === registrationId);
  const show = new Set<number>([0, 1, 2]);
  if (myIndex >= 0) for (let i = myIndex - 2; i <= myIndex + 2; i++) if (i >= 0 && i < table.length) show.add(i);
  const board = [...show]
    .filter((i) => i < table.length)
    .sort((a, b) => a - b)
    .map((i) => {
      const p = byId.get(table[i]!.id)!;
      return { place: placeOf(table[i]!.n), name: shortName(p.first_name, p.preferred_name, p.last_name), collected: table[i]!.n, isYou: table[i]!.id === registrationId };
    });

  return {
    collected: got.size,
    total: others.length,
    rank: got.size > 0 ? placeOf(got.size) : null,
    players: table.length,
    board,
    quests,
  };
}

/** How many different activities someone has been checked in to. */
export async function activitiesDone(db: D1Database, eventId: string, registrationId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count(DISTINCT s.context_id) AS n FROM scans s
        WHERE s.event_id = ? AND s.registration_id = ? AND s.context_type = 'activity' AND s.direction = 'in'
          AND s.outcome = 'accepted' AND NOT EXISTS (SELECT 1 FROM scans v WHERE v.supersedes_id = s.id)`,
    )
    .bind(eventId, registrationId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The staff view: everyone who has played, most collected first. */
export async function leaderboard(db: D1Database, eventId: string) {
  const { results } = await db
    .prepare(
      `SELECT c.collector_id AS id, count(*) AS n, p.first_name, p.preferred_name, p.last_name, r.group_name, r.section
         FROM side_quest_collections c JOIN registrations r ON r.id = c.collector_id JOIN people p ON p.id = r.person_id
        WHERE c.event_id = ? GROUP BY c.collector_id ORDER BY n DESC, p.last_name COLLATE NOCASE LIMIT 100`,
    )
    .bind(eventId)
    .all<{ id: string; n: number; first_name: string; preferred_name: string; last_name: string; group_name: string; section: string }>();
  const total = await db.prepare(`SELECT count(*) AS n FROM side_quest_collections WHERE event_id = ?`).bind(eventId).first<{ n: number }>();
  return {
    collections: total?.n ?? 0,
    rows: results.map((r, i, all) => ({
      registrationId: r.id,
      place: 1 + all.filter((x) => x.n > r.n).length,
      name: `${r.preferred_name || r.first_name} ${r.last_name}`,
      groupName: r.group_name,
      section: r.section,
      collected: r.n,
      rank: i,
    })),
  };
}
