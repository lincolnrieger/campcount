import type { Env } from '../env';
import { addDays, nowIso } from '../lib/time';

/** Daily housekeeping: expired auth artefacts. Retention purges are added with the features they cover. */
export async function runMaintenance(env: Env): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM login_challenges WHERE expires_at < ?`).bind(addDays(now, -1)),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?`).bind(addDays(now, -1), addDays(now, -30)),
  ]);
}
