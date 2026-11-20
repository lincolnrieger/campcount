import { Hono } from 'hono';
import { z } from 'zod';
import { designAssetIds, lanyardDesignSchema } from '../../shared/lanyardDesign';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { randomToken } from '../lib/crypto';
import { ApiError, badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { can } from '../services/principal';
import { getEventRow } from './events';

/**
 * The camp's lanyard design (made in the designer) and the images placed on
 * it. Reading needs either event setup or lanyard printing; changing needs
 * event setup, while the camp is a draft or open.
 */
export const lanyardDesignRoutes = new Hono<AppEnv>();
export const lanyardAssetRoutes = new Hono<AppEnv>();

/** Under D1's 2 MB value limit once base64'd. The designer shrinks images before upload. */
export const MAX_ASSET_BYTES = 1400 * 1024;
export const MAX_ASSETS_PER_EVENT = 40;
/** A design is a few kilobytes; this leaves plenty of room for 80 elements a side. */
const MAX_DESIGN_CHARS = 200_000;

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  // RIFF....WEBP
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

function requireReader(c: AppContext, eventId: string) {
  if (can(requirePrincipal(c), 'event.configure', { eventId })) return;
  requirePermission(c, 'credentials.manage', { eventId });
}

async function editableEvent(c: AppContext, eventId: string) {
  requirePermission(c, 'event.configure', { eventId });
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (event.status !== 'draft' && event.status !== 'open') throw conflict('This camp is closed, so its lanyard design can’t be changed.');
  return event;
}

// ---------------------------------------------------------------- design

lanyardDesignRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireReader(c, eventId);
  const row = await c.env.DB.prepare(`SELECT design, updated_at FROM lanyard_designs WHERE event_id = ?`)
    .bind(eventId)
    .first<{ design: string; updated_at: string }>();
  if (!row) return c.json({ design: null, updatedAt: null });
  const parsed = lanyardDesignSchema.safeParse(JSON.parse(row.design));
  return c.json({ design: parsed.success ? parsed.data : null, updatedAt: row.updated_at });
});

lanyardDesignRoutes.put('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const { design } = await parseBody(c, z.strictObject({ design: lanyardDesignSchema }));
  const text = JSON.stringify(design);
  if (text.length > MAX_DESIGN_CHARS) throw badRequest('This design is too big to save. Remove some elements.');

  // Every image the design uses must belong to this camp.
  const used = designAssetIds(design);
  if (used.length > 0) {
    const { results } = await c.env.DB.prepare(`SELECT id FROM lanyard_assets WHERE event_id = ? AND id IN (${used.map(() => '?').join(', ')})`)
      .bind(eventId, ...used)
      .all<{ id: string }>();
    if (results.length !== used.length) throw badRequest('An image in this design is missing. Upload it again.');
  }

  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO lanyard_designs (event_id, design, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id) DO UPDATE SET design = excluded.design, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(eventId, text, now, user.userId),
    // Images no longer on the design, uploaded more than a day ago (a day leaves room for undo).
    c.env.DB.prepare(
      `DELETE FROM lanyard_assets WHERE event_id = ? AND created_at < ?
         AND id NOT IN (SELECT value FROM json_each(?))`,
    ).bind(eventId, new Date(Date.now() - 86_400_000).toISOString(), JSON.stringify(used)),
  ]);
  // One audit line per hour of editing, not one per autosave.
  const recent = await c.env.DB.prepare(
    `SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'lanyard.design' AND actor_type = 'user' AND actor_id = ? AND at > ?`,
  )
    .bind(eventId, user.userId, new Date(Date.now() - 3_600_000).toISOString())
    .first();
  if (!recent) {
    await auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'lanyard.design', eventId, targetType: 'event', targetId: eventId }).run();
  }
  return c.json({ ok: true, updatedAt: now });
});

// ---------------------------------------------------------------- images

const uploadSchema = z.strictObject({ dataUrl: z.string().max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 64) });

lanyardAssetRoutes.post('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const { dataUrl } = await parseBody(c, uploadSchema);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw badRequest('Choose a PNG, JPEG or WebP image.');
  const [, type, data] = match as unknown as [string, string, string];
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  } catch {
    throw badRequest('That image could not be read.');
  }
  if (bytes.length > MAX_ASSET_BYTES) throw badRequest('That image is too big. Use one under 1.4 MB.');
  if (!SIGNATURES[type]!(bytes)) throw badRequest('That file is not the image type it claims to be.');
  const count = await c.env.DB.prepare(`SELECT count(*) AS n FROM lanyard_assets WHERE event_id = ?`).bind(eventId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ASSETS_PER_EVENT) throw new ApiError(409, 'too_many', 'This camp has too many lanyard images. Remove some from the design, then try again tomorrow.');
  const id = randomToken(16);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO lanyard_assets (id, event_id, content_type, data, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(
      id,
      eventId,
      type,
      data,
      bytes.length,
      nowIso(),
    ),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'lanyard.image', eventId, targetType: 'event', targetId: eventId, detail: { bytes: bytes.length } }),
  ]);
  return c.json({ id, url: `/api/events/${eventId}/lanyard-assets/${id}` }, 201);
});

lanyardAssetRoutes.get('/:assetId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireReader(c, eventId);
  const assetId = c.req.param('assetId');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(assetId)) throw notFound();
  const row = await c.env.DB.prepare(`SELECT content_type, data FROM lanyard_assets WHERE id = ? AND event_id = ?`)
    .bind(assetId, eventId)
    .first<{ content_type: string; data: string }>();
  if (!row) throw notFound();
  return new Response(Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0)), {
    headers: {
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    },
  });
});
