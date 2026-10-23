import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { ApiError } from '../lib/errors';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Security headers for API responses (static assets get theirs from public/_headers). */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (c.env.ENVIRONMENT === 'staging' || c.env.ENVIRONMENT === 'production') {
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
};

/**
 * CSRF defence in depth (cookies are already SameSite=Strict): state-changing
 * requests must come from our own origin and carry JSON.
 */
export const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    const fetchSite = c.req.header('Sec-Fetch-Site');
    if (origin !== c.env.APP_ORIGIN || (fetchSite && fetchSite !== 'same-origin')) {
      throw new ApiError(403, 'bad_origin', 'Request blocked.');
    }
    const length = Number(c.req.header('Content-Length') ?? '0');
    if (length > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', 'Request is too large.');
    const type = c.req.header('Content-Type') ?? '';
    if (length > 0 && !type.startsWith('application/json')) {
      throw new ApiError(415, 'unsupported_media_type', 'Requests must be JSON.');
    }
  }
  await next();
};
