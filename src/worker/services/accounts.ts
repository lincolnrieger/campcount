import type { Env } from '../env';
import { nowIso } from '../lib/time';
import { auditStatement } from './audit';
import type { AuditActor } from './audit';

/**
 * Delete an account. If the account appears in records that must be kept
 * (events it created, scans it made, dietary entries it recorded), it is
 * anonymised instead: name and email are wiped, it can never sign in again,
 * and the records stay intact without identifying the person.
 */
export async function deleteAccount(env: Env, userId: string, actor: AuditActor): Promise<'deleted' | 'anonymised'> {
  const db = env.DB;
  const now = nowIso();
  try {
    await db.batch([
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM login_challenges WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM password_links WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM assignments WHERE user_id = ?`).bind(userId),
      db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
      auditStatement(db, { actor, action: 'user.delete', targetType: 'user', targetId: userId }),
    ]);
    return 'deleted';
  } catch (err) {
    if (!String(err).includes('FOREIGN KEY')) throw err;
  }
  await db.batch([
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM login_challenges WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM password_links WHERE user_id = ?`).bind(userId),
    db.prepare(`UPDATE assignments SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?`).bind(now, userId),
    db.prepare(
      `UPDATE users SET email = ?, display_name = 'Deleted account', status = 'disabled', password_hash = NULL,
              email_verified_at = NULL, updated_at = ? WHERE id = ?`,
    ).bind(`deleted-${userId}@deleted.invalid`, now, userId),
    auditStatement(db, { actor, action: 'user.anonymise', targetType: 'user', targetId: userId }),
  ]);
  return 'anonymised';
}

/** Is this the only active platform admin left? */
export async function isLastAdmin(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT count(DISTINCT a.user_id) AS admins,
            max(a.user_id = ?) AS includes_user
       FROM assignments a JOIN users u ON u.id = a.user_id
      WHERE a.role_id = 'role_platform_admin' AND a.revoked_at IS NULL AND u.status = 'active'`,
  )
    .bind(userId)
    .first<{ admins: number; includes_user: number | null }>();
  return (row?.includes_user ?? 0) === 1 && (row?.admins ?? 0) <= 1;
}
