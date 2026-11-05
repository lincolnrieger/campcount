import type { Env } from '../env';
import { auditStatement } from './audit';

/**
 * Delete a camp and everything in it, for good: its scans, people's
 * registrations, lanyards, dietary records, activities, meals, bookings,
 * stations, staff assignments, logo and address. People who aren't on any
 * other camp are deleted too. Staff accounts stay (they may run other camps);
 * they just lose their place on this one. The audit log keeps a line saying
 * the camp was deleted, with no names.
 */
export async function deleteEvent(env: Env, adminUserId: string, eventId: string): Promise<{ people: number; scans: number } | null> {
  const db = env.DB;
  const event = await db.prepare(`SELECT id FROM events WHERE id = ?`).bind(eventId).first();
  if (!event) return null;
  const people = await db.prepare(`SELECT DISTINCT person_id AS id FROM registrations WHERE event_id = ?`).bind(eventId).all<{ id: string }>();
  const scans = await db.prepare(`SELECT count(*) AS n FROM scans WHERE event_id = ?`).bind(eventId).first<{ n: number }>();

  const statements: D1PreparedStatement[] = [
    // Corrections point at the scans they replace, so they go first.
    db.prepare(`DELETE FROM scans WHERE event_id = ? AND supersedes_id IS NOT NULL`).bind(eventId),
    db.prepare(`DELETE FROM scans WHERE event_id = ?`).bind(eventId),
    // Everything else belongs to the event and goes with it (ON DELETE CASCADE).
    db.prepare(`DELETE FROM events WHERE id = ?`).bind(eventId),
  ];
  const ids = people.results.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    statements.push(
      db
        .prepare(`DELETE FROM people WHERE id IN (${chunk.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.person_id = people.id)`)
        .bind(...chunk),
    );
  }
  statements.push(
    auditStatement(db, {
      actor: { type: 'user', id: adminUserId },
      action: 'event.delete',
      eventId,
      targetType: 'event',
      targetId: eventId,
      detail: { people: ids.length, scans: scans?.n ?? 0 },
    }),
  );
  await db.batch(statements);
  return { people: ids.length, scans: scans?.n ?? 0 };
}
