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
import { operationsRoutes } from './routes/operations';
import { rosterRoutes } from './routes/roster';
import { pairingRoutes, scanRoutes } from './routes/scans';
import { reportRoutes } from './routes/reports';
import { staffRoutes } from './routes/staff';
import { publicSignupRoutes, signupRoutes } from './routes/signup';
import { runMaintenance } from './services/maintenance';

export const app = new Hono<AppEnv>().basePath('/api');

app.use('*', securityHeaders);
// Refuse to run without the secret that signs sign-in codes and encrypts card tokens.
app.use('*', async (c, next) => {
  if (!c.env.AUTH_SECRET || c.env.AUTH_SECRET.length < 32) {
    console.error('AUTH_SECRET is not set (or shorter than 32 characters). Add it under Settings, Variables and Secrets.');
    throw new ApiError(503, 'not_configured', 'CampCount is not fully set up yet. Please tell your CampCount administrator.');
  }
  await next();
});
app.use('*', sameOriginWrites);
app.use('*', sessionMiddleware);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/admin', adminRoutes);
app.route('/events', eventRoutes);
app.route('/events/:eventId/staff', staffRoutes);
app.route('/events/:eventId', rosterRoutes);
app.route('/events/:eventId', operationsRoutes);
app.route('/events/:eventId', scanRoutes);
app.route('/events/:eventId', reportRoutes);
app.route('/events/:eventId', signupRoutes);
app.route('/public/signup', publicSignupRoutes);
app.route('/stations', pairingRoutes);

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
