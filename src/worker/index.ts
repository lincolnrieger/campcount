import { Hono } from 'hono';
import type { AppEnv } from './context';
import type { Env } from './env';
import { ApiError } from './lib/errors';
import { securityHeaders, sameOriginWrites } from './middleware/security';
import { sessionMiddleware } from './middleware/session';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { meRoutes } from './routes/me';
import { staffRoutes } from './routes/staff';
import { runMaintenance } from './services/maintenance';

export const app = new Hono<AppEnv>().basePath('/api');

app.use('*', securityHeaders);
app.use('*', sameOriginWrites);
app.use('*', sessionMiddleware);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/admin', adminRoutes);
app.route('/events', eventRoutes);
app.route('/events/:eventId/staff', staffRoutes);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  // Log the error type and route only; request bodies may contain personal data.
  console.error(`Unhandled error on ${c.req.method} ${c.req.routePath}: ${err.name}: ${err.message}`);
  return c.json({ error: { code: 'internal', message: 'Something went wrong. Please try again.' } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
