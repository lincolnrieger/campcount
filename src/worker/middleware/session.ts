import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../context';
import { SESSION_COOKIE, loadPrincipal } from '../services/sessions';

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  c.set('principal', token ? await loadPrincipal(c.env, token) : null);
  await next();
};
