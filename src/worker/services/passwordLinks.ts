import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { hmacHex, randomToken } from '../lib/crypto';
import { nowIso } from '../lib/time';
import { auditStatement } from './audit';
import type { AuditActor } from './audit';
import { EmailSendError, sendEmail } from './email';

export type LinkPurpose = 'setup' | 'reset';

/** New accounts get a week to set a password; a reset link lasts a day. */
const TTL_HOURS: Record<LinkPurpose, number> = { setup: 7 * 24, reset: 24 };

const hashToken = (env: Env, token: string) => hmacHex(env.AUTH_SECRET, `pwlink:${token}`);

export interface PasswordLink {
  url: string;
  expiresAt: string;
}

/**
 * Make a one-time password link for a person, retiring any earlier unused
 * one. The token goes in the URL fragment so mail scanners that pre-fetch
 * links never see it.
 */
export async function createPasswordLink(
  env: Env,
  origin: string,
  userId: string,
  purpose: LinkPurpose,
  actor: AuditActor,
): Promise<PasswordLink> {
  const now = nowIso();
  const token = randomToken(32);
  const expiresAt = new Date(Date.parse(now) + TTL_HOURS[purpose] * 3_600_000).toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`UPDATE password_links SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now, userId),
    env.DB.prepare(
      `INSERT INTO password_links (id, user_id, token_hash, purpose, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, userId, await hashToken(env, token), purpose, actor.type === 'user' ? actor.id : null, now, expiresAt),
    auditStatement(env.DB, { actor, action: `password_link.${purpose}`, targetType: 'user', targetId: userId }),
  ]);
  return { url: `${origin}/set-password#t=${token}`, expiresAt };
}

/** Email a password link. Returns false (and logs why) if the email could not be sent. */
export async function emailPasswordLink(
  env: Env,
  to: { email: string; name: string },
  link: PasswordLink,
  purpose: LinkPurpose,
  context?: { inviter: string; eventName?: string; roleName?: string },
): Promise<boolean> {
  const first = to.name.split(/\s+/)[0] || to.name;
  const days = purpose === 'setup' ? '7 days' : '24 hours';
  const lead =
    purpose === 'reset'
      ? 'Here is a link to choose a new CampCount password.'
      : context?.eventName
        ? `${context.inviter} has added you to ${context.eventName}${context.roleName ? ` as ${context.roleName}` : ''} on CampCount.`
        : `${context?.inviter ?? 'An administrator'} has made you a CampCount account.`;
  const action = purpose === 'reset' ? 'Choose a new password' : 'Set your password';
  try {
    await sendEmail(env, {
      to: to.email,
      subject: purpose === 'reset' ? 'Reset your CampCount password' : 'Set up your CampCount account',
      text: `Hi ${first},\n\n${lead}\n\n${action}:\n${link.url}\n\nThe link works once and expires in ${days}. If you weren't expecting this, ignore this email.`,
      html:
        `<p>Hi ${escapeHtml(first)},</p><p>${escapeHtml(lead)}</p>` +
        `<p><a href="${link.url}" style="display:inline-block;padding:12px 20px;background:#1f4d3f;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold">${action}</a></p>` +
        `<p>The link works once and expires in ${days}. If you weren't expecting this, ignore this email.</p>`,
    });
    return true;
  } catch (err) {
    const reason = err instanceof EmailSendError ? err.code : 'UNKNOWN';
    console.error(`Password link email could not be sent: ${reason}`);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const INVALID_LINK = () =>
  new ApiError(400, 'invalid_link', 'This link has expired or has already been used. Ask an admin for a new one, or sign in with an emailed code.');

export interface LinkTarget {
  linkId: string;
  userId: string;
  email: string;
  displayName: string;
  purpose: LinkPurpose;
}

/** Look up an unused, unexpired link without using it up. */
export async function findPasswordLink(env: Env, token: string): Promise<LinkTarget> {
  const row = await env.DB.prepare(
    `SELECT pl.id, pl.user_id, pl.purpose, u.email, u.display_name
       FROM password_links pl JOIN users u ON u.id = pl.user_id
      WHERE pl.token_hash = ? AND pl.used_at IS NULL AND pl.expires_at > ? AND u.status = 'active'`,
  )
    .bind(await hashToken(env, token), nowIso())
    .first<{ id: string; user_id: string; purpose: LinkPurpose; email: string; display_name: string }>();
  if (!row) throw INVALID_LINK();
  return { linkId: row.id, userId: row.user_id, email: row.email, displayName: row.display_name, purpose: row.purpose };
}

/** Mark a link used; false if another request got there first. */
export async function consumePasswordLink(env: Env, linkId: string): Promise<void> {
  const res = await env.DB.prepare(`UPDATE password_links SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(nowIso(), linkId).run();
  if (res.meta.changes !== 1) throw INVALID_LINK();
}
