export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_LIMITER?: RateLimit;
  /** Optional Cloudflare Email Service binding; required in staging/production. */
  EMAIL?: SendEmail;
  APP_ORIGIN: string;
  ENVIRONMENT: 'development' | 'test' | 'staging' | 'production';
  EMAIL_FROM: string;
  /** Secret used to HMAC login codes and tokens. Set with `wrangler secret put AUTH_SECRET`. */
  AUTH_SECRET: string;
}
