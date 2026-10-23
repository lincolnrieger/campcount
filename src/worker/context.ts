import type { Context } from 'hono';
import type { z } from 'zod';
import type { Permission } from '../shared/permissions';
import type { Env } from './env';
import { badRequest, forbidden, notFound, unauthenticated } from './lib/errors';
import type { Principal, Scope, UserPrincipal } from './services/principal';
import { can } from './services/principal';

export interface AppEnv {
  Bindings: Env;
  Variables: { principal: Principal | null };
}

export type AppContext = Context<AppEnv>;

export function requirePrincipal(c: AppContext): Principal {
  const principal = c.get('principal');
  if (!principal) throw unauthenticated();
  return principal;
}

export function requireUser(c: AppContext): UserPrincipal {
  const principal = requirePrincipal(c);
  if (principal.kind !== 'user') throw forbidden();
  return principal;
}

/**
 * Throws unless the caller holds `permission` in `scope`. When the caller has
 * no access to the event at all we answer 404, so event ids cannot be probed.
 */
export function requirePermission(c: AppContext, permission: Permission, scope: Scope = {}): Principal {
  const principal = requirePrincipal(c);
  if (can(principal, permission, scope)) return principal;
  if (scope.eventId && !can(principal, 'event.view', { eventId: scope.eventId })) throw notFound();
  throw forbidden();
}

export async function parseBody<S extends z.ZodType>(c: AppContext, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest(
      'Some details are missing or invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
