import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  passwordLinkCheckSchema,
  passwordLinkUseSchema,
  passwordSignInSchema,
  setPasswordSchema,
  signInRequestSchema,
  signInVerifySchema,
  signUpSchema,
} from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requireUser } from '../context';
import { ApiError } from '../lib/errors';
import { hmacHex, randomDigits, randomToken, sha256Hex, timingSafeEqualHex } from '../lib/crypto';
import { addMinutes, nowIso } from '../lib/time';
import { audit, auditStatement } from '../services/audit';
import { dummyVerify, hashPassword, passwordProblem, verifyPassword } from '../lib/passwords';
import { EmailSendError, sendEmail } from '../services/email';
import { SESSION_COOKIE, createSession, revokeSession } from '../services/sessions';
import { consumePasswordLink, findPasswordLink } from '../services/passwordLinks';

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
  if (user) await emailCode(c, user.id, email, 'sign-in');
  return c.json({ ok: true });
});

/**
 * Create an account with a password; a code is emailed to confirm the
 * address before the first sign-in. A new account has no access to anything
 * until someone adds it to an event. The answer is the same whether or not
 * the email is already registered (an existing account just gets a normal
 * sign-in code and its password is left alone), so this can't be used to
 * find out who has an account.
 */
authRoutes.post('/signup', async (c) => {
  const { email, displayName, password } = await parseBody(c, signUpSchema);
  const problem = passwordProblem(password, email);
  if (problem) throw new ApiError(400, 'weak_password', problem, [{ path: 'password', message: problem }]);
  await limitByIp(c, 'signup');
  await rateLimit(c, `email:${await sha256Hex(email)}`);

  const existing = await c.env.DB.prepare(`SELECT id, status FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string; status: string }>();
  if (existing) {
    if (existing.status === 'active') await emailCode(c, existing.id, email, 'sign-in');
    return c.json({ ok: true });
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, password_set_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, email, displayName, await hashPassword(c.env.AUTH_SECRET, password), now, now, now),
    auditStatement(c.env.DB, { actor: { type: 'public' }, action: 'user.signup', targetType: 'user', targetId: id }),
  ]);
  await emailCode(c, id, email, 'welcome');
  return c.json({ ok: true });
});

async function emailCode(c: AppContext, userId: string, email: string, kind: 'sign-in' | 'welcome'): Promise<void> {
  const now = nowIso();
  const id = crypto.randomUUID();
  const code = randomDigits(6);
  const linkToken = randomToken(24);
  await c.env.DB.batch([
    // Only the newest code is ever valid.
    c.env.DB.prepare(`UPDATE login_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL`).bind(now, userId),
    c.env.DB.prepare(
      `INSERT INTO login_challenges (id, user_id, code_hash, link_token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      await hmacHex(c.env.AUTH_SECRET, `code:${id}:${code}`),
      await hmacHex(c.env.AUTH_SECRET, `link:${linkToken}`),
      now,
      addMinutes(now, CODE_TTL_MINUTES),
    ),
  ]);
  // The token is in the URL fragment: it is never sent to a server, so mail
  // scanners that pre-fetch links (e.g. Microsoft Safe Links) cannot use it.
  const link = `${new URL(c.req.url).origin}/sign-in/verify#t=${linkToken}`;
  const minutes = CODE_TTL_MINUTES;
  const intro = kind === 'welcome' ? 'Welcome to CampCount! Your code to finish signing up is' : 'Your CampCount sign-in code is';
  try {
    await sendEmail(c.env, {
      to: email,
      subject: kind === 'welcome' ? `Welcome to CampCount: your code is ${code}` : `Your CampCount sign-in code: ${code}`,
      text:
        `${intro} ${code}\n\n` +
        `Or open this link and press "Sign in":\n${link}\n\n` +
        `The code expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
      html:
        `<p>${intro}</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>` +
        `<p>Or <a href="${link}">open this link</a> and press <strong>Sign in</strong>.</p>` +
        `<p>The code expires in ${minutes} minutes. If you did not ask for it, ignore this email.</p>`,
    });
  } catch (err) {
    const reason = err instanceof EmailSendError ? err.code : 'UNKNOWN';
    // Operator-facing detail goes to the logs (no address or sign-in code is logged).
    console.error(`Sign-in email could not be sent: ${reason}: ${err instanceof Error ? err.message : String(err)}`);
    throw new ApiError(503, 'email_unavailable', `The sign-in email could not be sent (${reason}). Please tell your CampCount administrator.`);
  }
}

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

  // Using a code proves the person controls the address.
  await c.env.DB.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL`)
    .bind(now, challenge.user_id)
    .run();
  await startSession(c, challenge.user_id, 'token' in input ? 'link' : 'code');
  return c.json({ ok: true });
});

export async function startSession(c: AppContext, userId: string, method: string): Promise<void> {
  const session = await createSession(c.env, { userId });
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    expires: new Date(session.expiresAt),
  });
  await audit(c.env.DB, { actor: { type: 'user', id: userId }, action: 'auth.sign_in', detail: { method } });
}

const WRONG_PASSWORD = () => new ApiError(400, 'invalid_credentials', 'Email or password is incorrect.');

/**
 * Everyday sign-in with a password. Accounts without a password (and unknown
 * emails) get the same answer, after the same amount of work.
 */
authRoutes.post('/password/sign-in', async (c) => {
  const { email, password } = await parseBody(c, passwordSignInSchema);
  await limitByIp(c, 'password');
  await rateLimit(c, `password:${await sha256Hex(email)}`);

  const user = await c.env.DB.prepare(`SELECT id, password_hash, email_verified_at FROM users WHERE email = ? AND status = 'active'`)
    .bind(email)
    .first<{ id: string; password_hash: string | null; email_verified_at: string | null }>();
  if (!user?.password_hash) {
    await dummyVerify(c.env.AUTH_SECRET, password);
    throw WRONG_PASSWORD();
  }
  if (!(await verifyPassword(c.env.AUTH_SECRET, password, user.password_hash))) {
    await audit(c.env.DB, { actor: { type: 'public' }, action: 'auth.password_failed', targetType: 'user', targetId: user.id });
    throw WRONG_PASSWORD();
  }
  // Right password, but the email was never confirmed (e.g. they left the
  // sign-up page before entering the code): send a fresh code instead.
  if (!user.email_verified_at) {
    await emailCode(c, user.id, email, 'welcome');
    return c.json({ ok: true, verify: true });
  }
  await startSession(c, user.id, 'password');
  return c.json({ ok: true });
});

/** Who a password link is for, so the page can greet them. Does not use the link up. */
authRoutes.post('/link/check', async (c) => {
  const { token } = await parseBody(c, passwordLinkCheckSchema);
  await limitByIp(c, 'link');
  const link = await findPasswordLink(c.env, token);
  return c.json({ email: link.email, displayName: link.displayName, purpose: link.purpose });
});

/** Set a password from a setup or reset link, then sign in. Signs out every other device. */
authRoutes.post('/link/use', async (c) => {
  const { token, password } = await parseBody(c, passwordLinkUseSchema);
  await limitByIp(c, 'link');
  const link = await findPasswordLink(c.env, token);
  const problem = passwordProblem(password, link.email);
  if (problem) throw new ApiError(400, 'weak_password', problem, [{ path: 'password', message: problem }]);
  await consumePasswordLink(c.env, link.linkId);
  const now = nowIso();
  await c.env.DB.batch([
    // The link was sent to (or passed on by an admin for) this person.
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_set_at = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
    ).bind(await hashPassword(c.env.AUTH_SECRET, password), now, now, now, link.userId),
    c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).bind(now, link.userId),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: link.userId },
      action: link.purpose === 'reset' ? 'auth.password_reset' : 'auth.password_set',
      detail: { via: 'link' },
    }),
  ]);
  await startSession(c, link.userId, `${link.purpose}-link`);
  return c.json({ ok: true });
});

/** A session this recent may set a password without the current one (the "forgot password" path). */
const FRESH_SESSION_MINUTES = 15;

authRoutes.post('/password', async (c) => {
  const user = requireUser(c);
  const { password, currentPassword } = await parseBody(c, setPasswordSchema);
  await rateLimit(c, `set-password:${user.userId}`);

  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
    .bind(user.userId)
    .first<{ password_hash: string | null }>();
  if (row?.password_hash) {
    const token = getCookie(c, SESSION_COOKIE)!;
    const session = await c.env.DB.prepare(`SELECT created_at FROM sessions WHERE id_hash = ?`)
      .bind(await sha256Hex(token))
      .first<{ created_at: string }>();
    const fresh = session && addMinutes(session.created_at, FRESH_SESSION_MINUTES) > nowIso();
    if (!fresh) {
      if (!currentPassword || !(await verifyPassword(c.env.AUTH_SECRET, currentPassword, row.password_hash))) {
        throw new ApiError(400, 'invalid_credentials', 'Your current password is incorrect.');
      }
    }
  }
  const problem = passwordProblem(password, user.email);
  if (problem) throw new ApiError(400, 'weak_password', problem, [{ path: 'password', message: problem }]);

  const now = nowIso();
  const currentHash = await sha256Hex(getCookie(c, SESSION_COOKIE)!);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?`).bind(
      await hashPassword(c.env.AUTH_SECRET, password),
      now,
      now,
      user.userId,
    ),
    // Changing a password signs out every other device.
    c.env.DB.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id_hash <> ? AND revoked_at IS NULL`).bind(
      now,
      user.userId,
      currentHash,
    ),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: row?.password_hash ? 'auth.password_changed' : 'auth.password_set' }),
  ]);
  return c.json({ ok: true });
});

authRoutes.post('/sign-out', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});
