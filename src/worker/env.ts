export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_LIMITER?: RateLimit;
  /** Optional Cloudflare Email Service binding; required in staging/production. */
  EMAIL?: SendEmail;
  ENVIRONMENT: 'development' | 'test' | 'production';
  EMAIL_FROM: string;
  /** The main address (campcount.com). Each event's own address is <subdomain>.<ROOT_DOMAIN>. */
  ROOT_DOMAIN?: string;
  /** Secret used to HMAC login codes and tokens. Set with `wrangler secret put AUTH_SECRET`. */
  AUTH_SECRET: string;
}
