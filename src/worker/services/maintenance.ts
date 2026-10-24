import type { Env } from '../env';
import { addDays, nowIso } from '../lib/time';
import { auditStatement } from './audit';
import { loadEventModel, summarise } from './reports';

/** Retention periods (docs/requirements.md §8). */
export const RETENTION = {
  sensitiveDays: 90, // dietary entries, photo consent, card tokens
  recordsDays: 730, // registrations and scans, kept for the annual report
} as const;

/** When an event stopped being active, for retention purposes. */
const CLOSED_AT = `COALESCE(closed_at, CASE WHEN status = 'cancelled' THEN updated_at END)`;

/**
 * Daily housekeeping: expired sign-in artefacts and the retention schedule.
 * Every purge is recorded in the audit log.
 */
export async function runMaintenance(env: Env, now = nowIso()): Promise<{ sensitive: number; records: number }> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM login_challenges WHERE expires_at < ?`).bind(addDays(now, -1)),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?`).bind(addDays(now, -1), addDays(now, -30)),
  ]);

  // Sign-ups whose email was never confirmed, after 7 days (accounts added to an event are kept).
  await env.DB.prepare(
    `DELETE FROM users WHERE email_verified_at IS NULL AND is_demo = 0 AND created_at < ?
        AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.user_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id)`,
  )
    .bind(addDays(now, -7))
    .run()
    .catch(() => undefined);

  // Stage 1: sensitive data, 90 days after close.
  const sensitive = await env.DB.prepare(
    `SELECT id FROM events WHERE status IN ('completed', 'archived', 'cancelled') AND sensitive_purged_at IS NULL AND ${CLOSED_AT} <= ?`,
  )
    .bind(addDays(now, -RETENTION.sensitiveDays))
    .all<{ id: string }>();
  for (const { id } of sensitive.results) {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM dietary_entries WHERE event_id = ?`).bind(id),
      env.DB.prepare(
        `UPDATE registrations SET photo_consent = 'unknown', dietary_source_hash = NULL, dietary_review_pending = 0, updated_at = ? WHERE event_id = ?`,
      ).bind(now, id),
      env.DB.prepare(
        `UPDATE credentials SET token_ciphertext = '', status = 'revoked', revoked_at = COALESCE(revoked_at, ?) WHERE event_id = ?`,
      ).bind(now, id),
      env.DB.prepare(`UPDATE events SET sensitive_purged_at = ?, fingerprint_key = lower(hex(randomblob(32))) WHERE id = ?`).bind(now, id),
      auditStatement(env.DB, { actor: { type: 'system' }, action: 'retention.purge_sensitive', eventId: id }),
    ]);
  }

  // Stage 2: named attendance records, 2 years after close. Totals are kept.
  const records = await env.DB.prepare(
    `SELECT id, feature_site FROM events WHERE status IN ('completed', 'archived', 'cancelled') AND records_purged_at IS NULL AND ${CLOSED_AT} <= ?`,
  )
    .bind(addDays(now, -RETENTION.recordsDays))
    .all<{ id: string; feature_site: number }>();
  for (const { id, feature_site } of records.results) {
    const summary = summarise(await loadEventModel(env.DB, id, feature_site === 1));
    await env.DB.batch([
      env.DB.prepare(`UPDATE events SET archive_summary = ? WHERE id = ?`).bind(JSON.stringify(summary), id),
      env.DB.prepare(`DELETE FROM scans WHERE event_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM activity_bookings WHERE event_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM credentials WHERE event_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM stations WHERE event_id = ?`).bind(id),
      env.DB.prepare(`DELETE FROM registrations WHERE event_id = ?`).bind(id),
      env.DB.prepare(`UPDATE events SET records_purged_at = ? WHERE id = ?`).bind(now, id),
      auditStatement(env.DB, { actor: { type: 'system' }, action: 'retention.purge_records', eventId: id }),
    ]);
  }

  // People no longer on any event roster, untouched for 2 years.
  await env.DB.prepare(
    `DELETE FROM people WHERE updated_at <= ? AND NOT EXISTS (SELECT 1 FROM registrations r WHERE r.person_id = people.id)`,
  )
    .bind(addDays(now, -RETENTION.recordsDays))
    .run();

  return { sensitive: sensitive.results.length, records: records.results.length };
}
