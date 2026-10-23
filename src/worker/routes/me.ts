import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { requirePrincipal } from '../context';
import { platformPermissions } from '../services/principal';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', (c) => {
  const principal = requirePrincipal(c);
  if (principal.kind === 'station') {
    return c.json({
      kind: 'station',
      station: {
        id: principal.stationId,
        eventId: principal.eventId,
        contextType: principal.contextType,
        contextId: principal.contextId,
      },
    });
  }
  return c.json({
    kind: 'user',
    user: {
      id: principal.userId,
      email: principal.email,
      displayName: principal.displayName,
      hasPassword: principal.hasPassword,
      isDemo: principal.isDemo,
    },
    platformPermissions: platformPermissions(principal),
  });
});

meRoutes.get('/roles', async (c) => {
  requirePrincipal(c);
  const { results } = await c.env.DB.prepare(
    `SELECT key, name, description, scope FROM roles WHERE scope <> 'platform' ORDER BY name`,
  ).all();
  return c.json({ roles: results });
});
