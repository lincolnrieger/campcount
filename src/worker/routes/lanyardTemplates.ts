import { Hono } from 'hono';
import { z } from 'zod';
import { LANYARD_TEMPLATE_SIDES, LANYARD_TEMPLATE_SIZES } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { can } from '../services/principal';
import { getEventRow } from './events';

/**
 * Lanyard artwork an event uploads: one PNG or JPEG per card size and side,
 * drawn behind the name, QR code and section CampCount prints. PNG and JPEG
 * only, because those are what the PDF builder can embed (and never SVG).
 */
export const lanyardTemplateRoutes = new Hono<AppEnv>();

/** Big enough for a 300 dpi lanyard as JPEG; stays inside D1's 2 MB value limit once base64'd. */
export const MAX_TEMPLATE_BYTES = 1400 * 1024;

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
const slot = z.strictObject({ size: z.enum(LANYARD_TEMPLATE_SIZES), side: z.enum(LANYARD_TEMPLATE_SIDES) });
const uploadSchema = z.strictObject({ dataUrl: z.string().max(Math.ceil((MAX_TEMPLATE_BYTES * 4) / 3) + 64) });

function params(c: AppContext) {
  const parsed = slot.safeParse({ size: c.req.param('size'), side: c.req.param('side') });
  if (!parsed.success) throw notFound();
  return parsed.data;
}

/** Whoever prints lanyards or sets the event up. */
function requireReader(c: AppContext, eventId: string) {
  if (can(requirePrincipal(c), 'event.configure', { eventId })) return;
  requirePermission(c, 'credentials.manage', { eventId });
}

lanyardTemplateRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireReader(c, eventId);
  const { results } = await c.env.DB.prepare(`SELECT size, side, updated_at FROM lanyard_templates WHERE event_id = ?`)
    .bind(eventId)
    .all<{ size: string; side: string; updated_at: string }>();
  return c.json({
    templates: results.map((t) => ({ size: t.size, side: t.side, url: `/api/events/${eventId}/lanyard-templates/${t.size}/${t.side}?v=${encodeURIComponent(t.updated_at)}` })),
  });
});

lanyardTemplateRoutes.get('/:size/:side', async (c) => {
  const eventId = c.req.param('eventId')!;
  requireReader(c, eventId);
  const { size, side } = params(c);
  const row = await c.env.DB.prepare(`SELECT content_type, data FROM lanyard_templates WHERE event_id = ? AND size = ? AND side = ?`)
    .bind(eventId, size, side)
    .first<{ content_type: string; data: string }>();
  if (!row) throw notFound();
  return new Response(Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0)), {
    headers: {
      'Content-Type': row.content_type,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
});

lanyardTemplateRoutes.put('/:size/:side', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.configure', { eventId });
  const user = requireUser(c);
  const { size, side } = params(c);
  if (!(await getEventRow(c.env.DB, eventId))) throw notFound();
  const { dataUrl } = await parseBody(c, uploadSchema);
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw badRequest('Upload a PNG or JPEG image.');
  const [, type, data] = match as unknown as [string, string, string];
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
  } catch {
    throw badRequest('That image could not be read.');
  }
  if (bytes.length > MAX_TEMPLATE_BYTES) throw badRequest('The artwork must be 1.4 MB or smaller. Save it as a JPEG.');
  if (!SIGNATURES[type]!(bytes)) throw badRequest('That file is not the image type it claims to be.');
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO lanyard_templates (event_id, size, side, content_type, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id, size, side) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(eventId, size, side, type, data, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'lanyard.template', eventId, targetType: 'event', targetId: eventId, detail: { size, side } }),
  ]);
  return c.json({ ok: true });
});

lanyardTemplateRoutes.delete('/:size/:side', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.configure', { eventId });
  const user = requireUser(c);
  const { size, side } = params(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM lanyard_templates WHERE event_id = ? AND size = ? AND side = ?`).bind(eventId, size, side),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'lanyard.template_removed', eventId, targetType: 'event', targetId: eventId, detail: { size, side } }),
  ]);
  return c.json({ ok: true });
});
