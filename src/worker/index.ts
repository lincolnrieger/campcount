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
import { logoRoutes, siteRoutes } from './routes/site';
import { teamRoutes } from './routes/teams';
import { dutyRoutes } from './routes/duties';
import { mealItemRoutes } from './routes/mealItems';
import { bannerRoutes, publicBannerRoutes } from './routes/banner';
import { lanyardTemplateRoutes } from './routes/lanyardTemplates';
import { lanyardAssetRoutes, lanyardDesignRoutes } from './routes/lanyardDesign';
import { resolveSite } from './services/site';
import { notFound } from './lib/errors';
import { runMaintenance } from './services/maintenance';
import { withVault } from './lib/vault';
import { ensureSealed } from './services/sealExisting';

/** The bindings with participant data decrypted on the way out of the database (see lib/vault.ts). */
export function vaultEnv(env: Env): Env {
  return { ...env, DB: withVault(env.DB, env) };
}

export const app = new Hono<AppEnv>().basePath('/api');

// A short reference for each request, shown on errors so a volunteer can read
// it out and the matching log line can be found. Cloudflare's Ray ID when present.
app.use('*', async (c, next) => {
  const ray = c.req.header('CF-Ray')?.split('-')[0];
  c.set('requestId', ray && /^[0-9a-f]{8,32}$/i.test(ray) ? ray : crypto.randomUUID().slice(0, 16));
  await next();
  c.res.headers.set('X-Request-Id', c.get('requestId'));
});
app.use('*', securityHeaders);
// Refuse to run without the secrets that sign sign-in codes and encrypt participant data.
app.use('*', async (c, next) => {
  for (const name of ['AUTH_SECRET', 'DATA_KEY'] as const) {
    if (!c.env[name] || c.env[name]!.length < 32) {
      console.error(`${name} is not set (or shorter than 32 characters). Add it under Settings, Variables and Secrets.`);
      throw new ApiError(503, 'not_configured', 'CampCount is not fully set up yet. Please tell your CampCount administrator.');
    }
  }
  await next();
});
// Participant data written before encryption is encrypted before anything else reads or writes it.
app.use('*', async (c, next) => {
  await ensureSealed(c.env);
  await next();
});
app.use('*', sameOriginWrites);
app.use('*', sessionMiddleware);
/**
 * The wall between sites. An event's own address only ever serves that
 * event: other events' data, creating events and the admin area are not
 * there (they answer 404, so nothing about them leaks).
 */
app.use('*', async (c, next) => {
  const site = await resolveSite(c);
  const path = new URL(c.req.url).pathname;
  if (site.kind === 'unknown' && !/^\/api\/(site|health)(\/|$)/.test(path)) throw notFound();
  if (site.kind === 'event') {
    if (path.startsWith('/api/admin') && !path.startsWith('/api/admin/preview')) throw notFound();
    if (path === '/api/events' && c.req.method !== 'GET') throw notFound();
    const m = /^\/api\/events\/([^/]+)/.exec(path);
    if (m && m[1] !== site.event.id) throw notFound();
  }
  await next();
});

/** For uptime monitoring: is the app up and can it reach the database? Says nothing else. */
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});
app.route('/site', siteRoutes);
app.route('/auth', authRoutes);
app.route('/me', meRoutes);
app.route('/admin', adminRoutes);
app.route('/events', eventRoutes);
app.route('/events/:eventId/staff', staffRoutes);
app.route('/events/:eventId/logo', logoRoutes);
app.route('/events/:eventId/banner', bannerRoutes);
app.route('/events/:eventId/lanyard-templates', lanyardTemplateRoutes);
app.route('/events/:eventId/lanyard-design', lanyardDesignRoutes);
app.route('/events/:eventId/lanyard-assets', lanyardAssetRoutes);
app.route('/events/:eventId', rosterRoutes);
app.route('/events/:eventId', operationsRoutes);
app.route('/events/:eventId', scanRoutes);
app.route('/events/:eventId', reportRoutes);
app.route('/events/:eventId', signupRoutes);
app.route('/events/:eventId', teamRoutes);
app.route('/events/:eventId', dutyRoutes);
app.route('/events/:eventId', mealItemRoutes);
app.route('/public/signup', publicSignupRoutes);
app.route('/public/banner', publicBannerRoutes);
app.route('/stations', pairingRoutes);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));

app.onError((err, c) => {
  const ref = c.get('requestId');
  if (err instanceof ApiError) {
    if (err.status === 429) console.warn(JSON.stringify({ level: 'warn', event: 'rate_limited', ref, route: c.req.routePath }));
    return c.json({ error: { code: err.code, message: err.message, details: err.details, ref } }, err.status);
  }
  // Log the error type and route only; request bodies may contain personal data.
  console.error(JSON.stringify({ level: 'error', event: 'unhandled', ref, method: c.req.method, route: c.req.routePath, error: `${err.name}: ${err.message}` }));
  return c.json({ error: { code: 'internal', message: `Something went wrong. Please try again. If it keeps happening, tell your CampCount administrator: reference ${ref}.`, ref } }, 500);
});

export default {
  fetch: (request, env, ctx) => app.fetch(request, vaultEnv(env), ctx),
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runMaintenance(vaultEnv(env)).then(
        (r) => console.log(JSON.stringify({ level: 'info', event: 'maintenance_done', ...r })),
        (err: unknown) => {
          // Shows in Workers logs and as a failed cron run, so an alert can watch for it.
          console.error(JSON.stringify({ level: 'error', event: 'maintenance_failed', error: err instanceof Error ? `${err.name}: ${err.message}` : 'unknown' }));
          throw err;
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
