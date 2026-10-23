import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { signInRequestSchema, signInVerifySchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody } from '../context';
import { ApiError } from '../lib/errors';
import { hmacHex, randomDigits, randomToken, sha256Hex, timingSafeEqualHex } from '../lib/crypto';
import { addMinutes, nowIso } from '../lib/time';
import { audit } from '../services/audit';
import { sendEmail } from '../services/email';
import { SESSION_COOKIE, createSession, revokeSession } from '../services/sessions';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const INVALID = () => new ApiError(400, 'invalid_code', 'That code is invalid or has expired. Request a new one.');

export const authRoutes = new Hono<AppEnv>();

async function rateLimit(c: AppContext, key: string): Promise<void> {
  if (!c.env.AUTH_LIMITER) return;
  const { success } = await c.env.AUTH_LIMITER.limit({ key });
  if (!success) throw new ApiError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
}

/** Cloudflare always sets CF-Connecting-IP in deployed environments; local runs skip per-IP limits. */
async function limitByIp(c: AppContext, bucket: string): Promise<void> {
  const ip = c.req.header('CF-Connecting-IP');
  if (ip) await rateLimit(c, `${bucket}:${ip}`);
}

/**
 * Request a sign-in code. The response is identical whether or not the email
 * belongs to an account, so accounts cannot be enumerated.
 */
authRoutes.post('/request', async (c) => {
  const { email } = await parseBody(c, signInRequestSchema);
  await limitByIp(c, 'request');
  await rateLimit(c, `email:${await sha256Hex(email)}`);

  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND status = 'active'`)
    .bind(email)
    .first<{ id: string }>();

  if (user) {
    const now = nowIso();
    const id = crypto.randomUUID();
    const code = randomDigits(6);
    const linkToken = randomToken(24);
    await c.env.DB.batch([
      // Only the newest code is ever valid.
      c.env.DB.prepare(
        `UPDATE login_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`,
      ).bind(now, user.id),
      c.env.DB.prepare(
        `INSERT INTO login_challenges (id, user_id, code_hash, link_token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        user.id,
        await hmacHex(c.env.AUTH_SECRET, `code:${id}:${code}`),
        await hmacHex(c.env.AUTH_SECRET, `link:${linkToken}`),
        now,
        addMinutes(now, CODE_TTL_MINUTES),
      ),
    ]);
    // The token is in the URL fragment: it is never sent to a server, so mail
    // scanners that pre-fetch links (e.g. Microsoft Safe Links) cannot use it.
    const link = `${c.env.APP_ORIGIN}/sign-in/verify#t=${linkToken}`;
    await sendEmail(c.env, {
      to: email,
      subject: `Your CampCount sign-in code: ${code}`,
      text:
        `Your CampCount sign-in code is ${code}\n\n` +
        `Or open this link and press "Sign in":\n${link}\n\n` +
        `The code expires in ${CODE_TTL_MINUTES} minutes. If you did not ask for it, ignore this email.`,
    });
  }
  return c.json({ ok: true });
});

authRoutes.post('/verify', async (c) => {
  const input = await parseBody(c, signInVerifySchema);
  await limitByIp(c, 'verify');
  const now = nowIso();

  let challenge: { id: string; user_id: string } | null;
  if ('token' in input) {
    challenge = await c.env.DB.prepare(
      `SELECT id, user_id FROM login_challenges
        WHERE link_token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
      .bind(await hmacHex(c.env.AUTH_SECRET, `link:${input.token}`), now)
      .first();
    if (!challenge) throw INVALID();
  } else {
    const row = await c.env.DB.prepare(
      `SELECT lc.id, lc.user_id, lc.code_hash, lc.attempts
         FROM login_challenges lc JOIN users u ON u.id = lc.user_id
        WHERE u.email = ? AND lc.consumed_at IS NULL AND lc.expires_at > ?
        ORDER BY lc.created_at DESC LIMIT 1`,
    )
      .bind(input.email, now)
      .first<{ id: string; user_id: string; code_hash: string; attempts: number }>();
    if (!row || row.attempts >= MAX_ATTEMPTS) throw INVALID();
    await c.env.DB.prepare(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`)
      .bind(row.id)
      .run();
    const expected = await hmacHex(c.env.AUTH_SECRET, `code:${row.id}:${input.code}`);
    if (!timingSafeEqualHex(expected, row.code_hash)) throw INVALID();
    challenge = row;
  }

  // Consume atomically so a code or link can only ever be used once.
  const consumed = await c.env.DB.prepare(
    `UPDATE login_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
  )
    .bind(now, challenge.id)
    .run();
  if (consumed.meta.changes !== 1) throw INVALID();

  const active = await c.env.DB.prepare(`SELECT 1 FROM users WHERE id = ? AND status = 'active'`)
    .bind(challenge.user_id)
    .first();
  if (!active) throw INVALID();

  const session = await createSession(c.env, { userId: challenge.user_id });
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    expires: new Date(session.expiresAt),
  });
  await audit(c.env.DB, {
    actor: { type: 'user', id: challenge.user_id },
    action: 'auth.sign_in',
    detail: { method: 'token' in input ? 'link' : 'code' },
  });
  return c.json({ ok: true });
});

authRoutes.post('/sign-out', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});
