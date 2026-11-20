import type { AppContext } from '../context';
import { ApiError } from './errors';

/**
 * Rate limits, in two layers.
 *
 * 1. Per person or per email (AUTH_LIMITER, 10 a minute). This is what stops
 *    someone guessing one account's password or code, or spamming one inbox.
 * 2. Per network (AUTH_NETWORK_LIMITER and PUBLIC_NETWORK_LIMITER). At camp,
 *    hundreds of phones share one internet address (camp Wi-Fi, or a mobile
 *    carrier's shared address), so this is only a high ceiling against one
 *    machine hammering us. It must never be low enough to block a whole camp
 *    signing up at once.
 *
 * Bindings are optional so local runs and tests work without them. Cloudflare
 * always sets CF-Connecting-IP in deployed environments; local runs skip the
 * per-network limits.
 */

const tooMany = (message: string) => new ApiError(429, 'rate_limited', message);

async function check(limiter: RateLimit | undefined, key: string, message: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw tooMany(message);
}

/** Per account, email or person: the tight limit. */
export function limitPerKey(c: AppContext, key: string, message = 'Too many attempts. Wait a minute and try again.') {
  return check(c.env.AUTH_LIMITER, key, message);
}

/** The shared-network ceiling for sign-in and pairing endpoints (staff). */
export function limitAuthNetwork(c: AppContext, bucket: string) {
  const ip = c.req.header('CF-Connecting-IP');
  if (!ip) return Promise.resolve();
  return check(
    c.env.AUTH_NETWORK_LIMITER,
    `${bucket}:${ip}`,
    'A lot of people on this network are signing in right now. Wait a minute and try again.',
  );
}

/** The shared-network ceiling for participant sign-up (lanyard links and the kiosk). */
export function limitPublicNetwork(c: AppContext, bucket: string) {
  const ip = c.req.header('CF-Connecting-IP');
  if (!ip) return Promise.resolve();
  return check(
    c.env.PUBLIC_NETWORK_LIMITER,
    `${bucket}:${ip}`,
    'Sign-up is very busy right now. Wait a minute and try again.',
  );
}
