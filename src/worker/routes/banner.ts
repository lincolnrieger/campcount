import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { getEventRow } from './events';

/**
 * A camp's banner graphic, shown at the top of every participant's page
 * (the page their lanyard opens) instead of the camp's name.
 */
export const bannerRoutes = new Hono<AppEnv>();
/** The image itself, for participants' phones: public, by event and version. */
export const publicBannerRoutes = new Hono<AppEnv>();

/** Under D1's 2 MB value limit once base64'd. The browser shrinks big images before upload. */
const MAX_BANNER_BYTES = 1400 * 1024;
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};
const uploadSchema = z.strictObject({
  dataUrl: z.string().max(Math.ceil((MAX_BANNER_BYTES * 4) / 3) + 64),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

/** The banner's address, or null. The version in it changes with each upload, so phones can cache it. */
export async function bannerUrl(db: D1Database, eventId: string): Promise<{ url: string; width: number; height: number } | null> {
  const row = await db.prepare(`SELECT updated_at, width, height FROM event_banners WHERE event_id = ?`).bind(eventId).first<{ updated_at: string; width: number; height: number }>();
  return row ? { url: `/api/public/banner/${eventId}?v=${encodeURIComponent(row.updated_at)}`, width: row.width, height: row.height } : null;
}

async function editable(c: AppContext, eventId: string) {
  requirePermission(c, 'event.configure', { eventId });
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to make changes.');
}

bannerRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.configure', { eventId });
  return c.json({ banner: await bannerUrl(c.env.DB, eventId) });
});

bannerRoutes.put('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  await editable(c, eventId);
  const user = requireUser(c);
  const { dataUrl, width, height } = await parseBody(c, uploadSchema);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw badRequest('Choose a PNG, JPEG or WebP image.');
  const [, type, data] = match as unknown as [string, string, string];
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  } catch {
    throw badRequest('That image could not be read.');
  }
  if (bytes.length > MAX_BANNER_BYTES) throw badRequest('That image is too big. Use one under 1.4 MB.');
  if (!SIGNATURES[type]!(bytes)) throw badRequest('That file is not the image type it claims to be.');
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO event_banners (event_id, content_type, data, width, height, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, width = excluded.width, height = excluded.height, updated_at = excluded.updated_at`,
    ).bind(eventId, type, data, width, height, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'event.banner', eventId, targetType: 'event', targetId: eventId, detail: { bytes: bytes.length } }),
  ]);
  return c.json({ banner: await bannerUrl(c.env.DB, eventId) });
});

bannerRoutes.delete('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  await editable(c, eventId);
  const user = requireUser(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM event_banners WHERE event_id = ?`).bind(eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'event.banner_removed', eventId, targetType: 'event', targetId: eventId, onlyIfChanged: true }),
  ]);
  return c.json({ ok: true });
});

publicBannerRoutes.get('/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  if (!z.uuid().safeParse(eventId).success) throw notFound();
  const row = await c.env.DB.prepare(`SELECT content_type, data FROM event_banners WHERE event_id = ?`).bind(eventId).first<{ content_type: string; data: string }>();
  if (!row) throw notFound();
  return new Response(Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0)), {
    headers: {
      'Content-Type': row.content_type,
      // The address carries the version, so a new upload is a new address.
      'Cache-Control': c.req.query('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    },
  });
});
