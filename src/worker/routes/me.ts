import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { parseBody, requirePrincipal, requireUser } from '../context';
import { ApiError, conflict } from '../lib/errors';
import { sha256Hex } from '../lib/crypto';
import { verifyPassword } from '../lib/passwords';
import { addMinutes, nowIso } from '../lib/time';
import { deleteAccount, isLastAdmin } from '../services/accounts';
import { SESSION_COOKIE } from '../services/sessions';
import { platformPermissions } from '../services/principal';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', (c) => {
  const principal = requirePrincipal(c);
  if (principal.kind === 'station') {
    return c.json({
      kind: 'station',
      station: {
        id: principal.stationId,
        eventId: principal.eventId,
        contextType: principal.contextType,
        contextId: principal.contextId,
      },
    });
  }
  return c.json({
    kind: 'user',
    user: {
      id: principal.userId,
      email: principal.email,
      displayName: principal.displayName,
      hasPassword: principal.hasPassword,
      isDemo: principal.isDemo,
    },
    preview: principal.preview ?? null,
    platformPermissions: platformPermissions(principal),
  });
});

meRoutes.get('/roles', async (c) => {
  requirePrincipal(c);
  const { results } = await c.env.DB.prepare(
    `SELECT key, name, description, scope FROM roles WHERE scope <> 'platform' ORDER BY name`,
  ).all();
  return c.json({ roles: results });
});

const mePatchSchema = z.strictObject({ displayName: z.string().trim().min(1).max(100) });

meRoutes.patch('/', async (c) => {
  const user = requireUser(c);
  const { displayName } = await parseBody(c, mePatchSchema);
  await c.env.DB.prepare(`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`).bind(displayName, nowIso(), user.userId).run();
  return c.json({ ok: true });
});

/** Delete your own account. Needs your password (or a sign-in in the last 15 minutes if you have none). */
meRoutes.delete('/', async (c) => {
  const user = requireUser(c);
  const { password } = await parseBody(c, z.strictObject({ password: z.string().max(200).optional() }));
  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.userId).first<{ password_hash: string | null }>();
  if (row?.password_hash) {
    if (!password || !(await verifyPassword(c.env.AUTH_SECRET, password, row.password_hash))) {
      throw new ApiError(400, 'invalid_credentials', 'Your password is incorrect.');
    }
  } else {
    const session = await c.env.DB.prepare(`SELECT created_at FROM sessions WHERE id_hash = ?`)
      .bind(await sha256Hex(getCookie(c, SESSION_COOKIE) ?? ''))
      .first<{ created_at: string }>();
    if (!session || addMinutes(session.created_at, 15) < nowIso()) {
      throw new ApiError(400, 'reauth_required', 'Sign in again, then delete your account within 15 minutes.');
    }
  }
  if (await isLastAdmin(c.env, user.userId)) throw conflict('You are the only admin. Make someone else an admin first.');
  await deleteAccount(c.env, user.userId, { type: 'user', id: user.userId });
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});
