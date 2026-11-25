export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Per account, email or person: 10 a minute. */
  AUTH_LIMITER?: RateLimit;
  /** Per network address for sign-in and pairing: a high ceiling, because a whole camp can share one address. */
  AUTH_NETWORK_LIMITER?: RateLimit;
  /** Per network address for participant sign-up: a higher ceiling still. */
  PUBLIC_NETWORK_LIMITER?: RateLimit;
  /** Optional Cloudflare Email Service binding; required in staging/production. */
  EMAIL?: SendEmail;
  ENVIRONMENT: 'development' | 'test' | 'production';
  EMAIL_FROM: string;
  /** The main address (campcount.com). Each event's own address is <subdomain>.<ROOT_DOMAIN>. */
  ROOT_DOMAIN?: string;
  /** Secret used to HMAC login codes and tokens. Set with `wrangler secret put AUTH_SECRET`. */
  AUTH_SECRET: string;
  /**
   * Secret that encrypts participant data (names, participant IDs and
   * lanyard codes). At least 32 characters. Separate from AUTH_SECRET, and
   * never rotated casually: data sealed under it can't be read without it.
   */
  DATA_KEY: string;
}
