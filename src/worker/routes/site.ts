import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, AppContext } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { can } from '../services/principal';
import { badRequest, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { resolveSite } from '../services/site';
import { getEventRow } from './events';

/**
 * What this address is: the main (platform) site, one event's own site, or
 * an address no event uses. Public: the sign-in page shows the event's name,
 * colour and logo before anyone signs in.
 */
export const siteRoutes = new Hono<AppEnv>();

siteRoutes.get('/', async (c) => {
  const site = await resolveSite(c);
  const root = c.env.ROOT_DOMAIN ?? null;
  if (site.kind === 'event') {
    const e = site.event;
    const logo = await c.env.DB.prepare(`SELECT updated_at FROM event_logos WHERE event_id = ?`).bind(e.id).first<{ updated_at: string }>();
    return c.json({
      kind: 'event',
      rootDomain: root,
      event: {
        id: e.id,
        name: e.name,
        subdomain: e.subdomain,
        brandColor: e.brand_color,
        logoUrl: logo ? `/api/site/logo?v=${encodeURIComponent(logo.updated_at)}` : null,
      },
    });
  }
  if (site.kind === 'unknown') return c.json({ kind: 'unknown', rootDomain: root, subdomain: site.subdomain });
  return c.json({ kind: 'platform', rootDomain: root });
});

async function sendLogo(c: AppContext, eventId: string) {
  const row = await c.env.DB.prepare(`SELECT content_type, data FROM event_logos WHERE event_id = ?`).bind(eventId).first<{ content_type: string; data: string }>();
  if (!row) throw notFound();
  const bytes = Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': row.content_type,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

siteRoutes.get('/logo', async (c) => {
  const site = await resolveSite(c);
  if (site.kind !== 'event') throw notFound();
  return sendLogo(c, site.event.id);
});

/** Logos are PNG, JPEG or WebP (never SVG, which can carry script), at most 300 KB. */
const MAX_LOGO_BYTES = 300 * 1024;
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};
const logoSchema = z.strictObject({ dataUrl: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 64) });

/** Event logos, for the admin console and the event's Settings. */
export const logoRoutes = new Hono<AppEnv>();

logoRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.view', { eventId });
  return sendLogo(c, eventId);
});

/** Event managers, or platform admins (who brand events from the main site). */
function requireBranding(c: AppContext, eventId: string) {
  if (!can(requirePrincipal(c), 'platform.events.create')) requirePermission(c, 'event.configure', { eventId });
}

logoRoutes.put('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireBranding(c, eventId);
  const user = requireUser(c);
  if (!(await getEventRow(c.env.DB, eventId))) throw notFound();
  const { dataUrl } = await parseBody(c, logoSchema);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw badRequest('Upload a PNG, JPEG or WebP image.');
  const [, type, data] = match as unknown as [string, string, string];
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  } catch {
    throw badRequest('That image could not be read.');
  }
  if (bytes.length > MAX_LOGO_BYTES) throw badRequest('The logo must be 300 KB or smaller.');
  if (!SIGNATURES[type]!(bytes)) throw badRequest('That file is not the image type it claims to be.');
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO event_logos (event_id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(eventId, type, data, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'event.logo', eventId, targetType: 'event', targetId: eventId }),
  ]);
  return c.json({ ok: true, updatedAt: now });
});

logoRoutes.delete('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireBranding(c, eventId);
  const user = requireUser(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM event_logos WHERE event_id = ?`).bind(eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'event.logo_removed', eventId, targetType: 'event', targetId: eventId }),
  ]);
  return c.json({ ok: true });
});
