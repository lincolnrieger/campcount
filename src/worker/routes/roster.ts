import { Hono } from 'hono';
import { z } from 'zod';
import { credentialUrl, formatShortCode, memberCardCode } from '../../shared/credentials';
import { displayName } from '../../shared/names';
import { isEditable } from '../../shared/lifecycle';
import { personEntrySchema, registrationPatchSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { decryptToken, issueStatements } from '../services/credentials';
import { can } from '../services/principal';
import { getEventRow } from './events';
import { loadEventModel, whereabouts } from '../services/reports';
import { roleStyle } from '../../shared/roles';
import { addToRoster, guestNumber, toRosterRow } from '../services/rosterWrites';
import { participantKey, seal, shortCodeKey } from '../lib/vault';
import { compareText, sortByName } from '../lib/sort';

export const rosterRoutes = new Hono<AppEnv>();

const BATCH_SIZE = 80;

async function runInBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
}

export { displayName };

async function editableEvent(c: AppContext, eventId: string) {
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to change the roster.');
  return event;
}

// ---------------------------------------------------------------- roster

rosterRoutes.get('/registrations', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.view', { eventId });
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.participant_id, p.first_name, p.last_name, r.kind, r.status,
            (SELECT short_code FROM credentials cr WHERE cr.registration_id = r.id AND cr.status = 'active') AS short_code
       FROM registrations r JOIN people p ON p.id = r.person_id
      WHERE r.event_id = ?`,
  )
    .bind(eventId)
    .all<Record<string, string | null>>();
  sortByName(results);
  return c.json({
    registrations: results.map((r) => ({
      id: r.id,
      participantId: r.participant_id,
      firstName: r.first_name,
      lastName: r.last_name,
      displayName: displayName(r.first_name!, r.last_name!),
      kind: r.kind,
      status: r.status,
      shortCode: r.short_code ? formatShortCode(r.short_code) : null,
    })),
  });
});

// ---------------------------------------------------------------- one person

const regParam = (value: string | undefined) => {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

/** One person's page: details, where they are now and everywhere they've been scanned. */
rosterRoutes.get('/registrations/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'roster.view', { eventId });
  const id = regParam(c.req.param('registrationId'));
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  const r = await c.env.DB.prepare(
    `SELECT r.id, p.participant_id, p.first_name, p.last_name, r.kind, r.status, r.created_at, r.updated_at,
            (SELECT short_code FROM credentials cr WHERE cr.registration_id = r.id AND cr.status = 'active') AS short_code
       FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.id = ? AND r.event_id = ?`,
  )
    .bind(id, eventId)
    .first<Record<string, string | null>>();
  if (!r) throw notFound();
  const [scans, model] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.id, s.context_type, s.context_id, s.direction, s.method, s.device_time, s.outcome, s.correction_reason,
              COALESCE(u.display_name, st.name, '') AS actor,
              COALESCE(a.name, m.name, CASE WHEN s.context_type = 'site' THEN 'Gate' END, 'Deleted') AS place
         FROM scans s
         LEFT JOIN users u ON u.id = s.actor_user_id
         LEFT JOIN stations st ON st.id = s.actor_station_id
         LEFT JOIN activities a ON s.context_type = 'activity' AND a.id = s.context_id
         LEFT JOIN meal_services m ON s.context_type = 'meal' AND m.id = s.context_id
        WHERE s.registration_id = ? AND s.event_id = ?
        ORDER BY s.device_time DESC LIMIT 300`,
    )
      .bind(id, eventId)
      .all<Record<string, string>>(),
    loadEventModel(c.env.DB, eventId, event.feature_site === 1),
  ]);
  const bookings = await c.env.DB.prepare(
    `SELECT a.id, a.name, a.starts_at, a.ends_at, b.source FROM activity_bookings b JOIN activities a ON a.id = b.activity_id
      WHERE b.registration_id = ? ORDER BY a.starts_at IS NULL, a.starts_at`,
  )
    .bind(id)
    .all<{ id: string; name: string; starts_at: string | null; ends_at: string | null; source: string }>();
  const outcomeOf = (scanId: string, key: string) => model.replays.get(key)?.outcomes.get(scanId);
  return c.json({
    registration: {
      id: r.id,
      participantId: r.participant_id,
      firstName: r.first_name,
      lastName: r.last_name,
      displayName: displayName(r.first_name!, r.last_name!),
      kind: r.kind,
      status: r.status,
      shortCode: r.short_code ? formatShortCode(r.short_code) : null,
    },
    can: {
      edit: can(principal, 'roster.edit', { eventId }) && isEditable(event.status),
      cards: can(principal, 'credentials.manage', { eventId }),
    },
    where: whereabouts(model).get(id) ?? null,
    bookings: bookings.results.map((b) => ({ activityId: b.id, name: b.name, startsAt: b.starts_at, endsAt: b.ends_at, selfBooked: b.source === 'self_signup' })),
    history: scans.results.map((s) => {
      const evaluated = outcomeOf(s.id!, `${s.context_type}:${s.context_id ?? ''}`);
      return {
        id: s.id,
        at: s.device_time,
        type: s.context_type,
        place: s.place,
        direction: s.direction,
        method: s.method,
        outcome: evaluated?.outcome ?? s.outcome,
        message: evaluated?.message ?? s.correction_reason,
        by: s.actor,
      };
    }),
  });
});

rosterRoutes.patch('/registrations/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const id = regParam(c.req.param('registrationId'));
  const input = await parseBody(c, registrationPatchSchema);
  await editableEvent(c, eventId);
  const reg = await c.env.DB.prepare(`SELECT person_id FROM registrations WHERE id = ? AND event_id = ?`).bind(id, eventId).first<{ person_id: string }>();
  if (!reg) throw notFound();

  const personCols: Record<string, string> = { participantId: 'participant_id', firstName: 'first_name', lastName: 'last_name' };
  const regCols: Record<string, string> = { kind: 'kind', status: 'status' };
  /** Stored encrypted. */
  const sealed = new Set(['participantId', 'firstName', 'lastName']);
  const set = (cols: Record<string, string>) => Object.keys(input).filter((k) => k in cols && input[k as keyof typeof input] !== undefined);
  const pKeys = set(personCols);
  const rKeys = set(regCols);
  if (pKeys.length + rKeys.length === 0) return c.json({ ok: true });
  if (pKeys.length) {
    const sharedWith = await c.env.DB.prepare(`SELECT DISTINCT event_id FROM registrations WHERE person_id = ? AND event_id <> ?`)
      .bind(reg.person_id, eventId)
      .all<{ event_id: string }>();
    if (sharedWith.results.some((r) => !can(c.get('principal')!, 'roster.edit', { eventId: r.event_id }))) {
      throw conflict('This person is also on another camp, so their name and participant ID can only be changed by someone who runs both camps.');
    }
  }
  const value = async (k: string) => {
    const v = input[k as keyof typeof input] as string;
    return sealed.has(k) ? seal(c.env, v) : v;
  };
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (pKeys.length) {
    const cols = pKeys.map((k) => `${personCols[k]} = ?`);
    const binds: unknown[] = await Promise.all(pKeys.map(value));
    if (input.participantId !== undefined) {
      cols.push('participant_key = ?');
      binds.push(await participantKey(c.env, input.participantId));
    }
    statements.push(c.env.DB.prepare(`UPDATE people SET ${cols.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, now, reg.person_id));
  }
  // The lanyard's typed code is the participant ID: keep it in step (the QR doesn't change).
  const newCode = input.participantId !== undefined ? memberCardCode(input.participantId) : null;
  if (newCode) {
    statements.push(
      c.env.DB.prepare(`UPDATE credentials SET short_code = ?, short_code_key = ? WHERE registration_id = ? AND status = 'active'`).bind(
        await seal(c.env, newCode),
        await shortCodeKey(c.env, newCode),
        id,
      ),
    );
  }
  if (rKeys.length) {
    statements.push(
      c.env.DB.prepare(`UPDATE registrations SET ${rKeys.map((k) => `${regCols[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(
        ...(await Promise.all(rKeys.map(value))),
        now,
        id,
      ),
    );
  }
  statements.push(
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'registration.update',
      eventId,
      targetType: 'registration',
      targetId: id,
      detail: { fields: [...pKeys, ...rKeys].join(',') },
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw conflict('Someone else already has that participant ID.');
    throw err;
  }
  return c.json({ ok: true });
});

/**
 * Remove someone from the event entirely: their card, bookings and every
 * scan go too. Withdrawing keeps the records; deleting is
 * for mistakes and test data. The audit log keeps the count, not the name.
 */
rosterRoutes.delete('/registrations/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const id = regParam(c.req.param('registrationId'));
  await editableEvent(c, eventId);
  const reg = await c.env.DB.prepare(`SELECT person_id, (SELECT count(*) FROM scans s WHERE s.registration_id = r.id) AS scans FROM registrations r WHERE id = ? AND event_id = ?`)
    .bind(id, eventId)
    .first<{ person_id: string; scans: number }>();
  if (!reg) throw notFound();
  await c.env.DB.batch([
    // Corrections point at the scans they replace; clear those links first.
    c.env.DB.prepare(`DELETE FROM scans WHERE supersedes_id IN (SELECT id FROM scans WHERE registration_id = ?)`).bind(id),
    c.env.DB.prepare(`DELETE FROM registrations WHERE id = ? AND event_id = ?`).bind(id, eventId),
    // The person record goes too unless they are on another event.
    c.env.DB.prepare(`DELETE FROM people WHERE id = ? AND NOT EXISTS (SELECT 1 FROM registrations WHERE person_id = ?)`).bind(reg.person_id, reg.person_id),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'registration.delete',
      eventId,
      targetType: 'registration',
      targetId: id,
      detail: { scans: reg.scans },
    }),
  ]);
  return c.json({ ok: true, scans: reg.scans });
});

/** An event manager adds someone by hand. They join the roster straight away, with a card. */
rosterRoutes.post('/registrations', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const e = await editableEvent(c, eventId);
  const input = await parseBody(c, personEntrySchema);
  const participantId = input.participantId?.toUpperCase() ?? guestNumber();
  const already = await c.env.DB.prepare(`SELECT 1 FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.participant_key = ? AND r.status = 'active'`)
    .bind(e.id, await participantKey(c.env, participantId))
    .first();
  if (already) throw conflict('Someone with that participant ID is already on this event.');
  const registrationId = await addToRoster(c.env, e.id, toRosterRow({ ...input, participantId }), (await namesLockedElsewhere(c, e.id, [participantId])).has(participantId));
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'registration.add',
    eventId: e.id,
    targetType: 'registration',
    targetId: registrationId,
  }).run();
  return c.json({ registrationId }, 201);
});

// ---------------------------------------------------------------- shared people

/**
 * People records are shared between camps (one per participant ID). A camp's
 * team may only change a shared person's names if they can also edit every
 * other camp that person is on; otherwise one camp could rename a child on
 * another camp's roster and lanyards. Returns the participant IDs whose
 * names this caller must leave alone.
 */
async function namesLockedElsewhere(c: AppContext, eventId: string, participantIds: string[]): Promise<Set<string>> {
  const principal = c.get('principal')!;
  const byKey = new Map<string, string>();
  for (const id of new Set(participantIds)) byKey.set(await participantKey(c.env, id), id);
  const keys = [...byKey.keys()];
  const locked = new Set<string>();
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT p.participant_key, r.event_id FROM people p JOIN registrations r ON r.person_id = p.id
        WHERE r.event_id <> ? AND p.participant_key IN (${chunk.map(() => '?').join(', ')})`,
    )
      .bind(eventId, ...chunk)
      .all<{ participant_key: string; event_id: string }>();
    for (const r of results) if (!can(principal, 'roster.edit', { eventId: r.event_id })) locked.add(byKey.get(r.participant_key)!);
  }
  return locked;
}

// ---------------------------------------------------------------- credentials

const issueSchema = z.strictObject({
  mode: z.enum(['missing', 'replace']),
  registrationIds: z.array(z.uuid()).max(2000).optional(),
});

rosterRoutes.post('/credentials/issue', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const user = requireUser(c);
  const { mode, registrationIds } = await parseBody(c, issueSchema);
  await editableEvent(c, eventId);
  if (mode === 'replace' && !registrationIds?.length) {
    throw badRequest('Choose whose lanyards to replace.');
  }

  const { results } = await c.env.DB.prepare(
    `SELECT r.id FROM registrations r
      WHERE r.event_id = ? AND r.status = 'active'
        AND (? = 'replace' OR NOT EXISTS (SELECT 1 FROM credentials cr WHERE cr.registration_id = r.id AND cr.status = 'active'))`,
  )
    .bind(eventId, mode)
    .all<{ id: string }>();
  const wanted = registrationIds ? new Set(registrationIds) : null;
  const targets = results.map((r) => r.id).filter((id) => !wanted || wanted.has(id));

  for (let attempt = 0; ; attempt++) {
    try {
      await runInBatches(c.env.DB, await issueStatements(c.env, eventId, targets));
      break;
    } catch (err) {
      // Short-code collision (1 in ~10^11 per pair): regenerate. Issuing is idempotent per registration.
      if (attempt < 2 && String(err).includes('UNIQUE')) continue;
      throw err;
    }
  }
  if (targets.length > 0) {
    await auditStatementRun(c, {
      action: mode === 'replace' ? 'credentials.replace' : 'credentials.issue',
      eventId,
      userId: user.userId,
      count: targets.length,
    });
  }
  return c.json({ issued: targets.length });
});

async function auditStatementRun(c: AppContext, a: { action: string; eventId: string; userId: string; count: number }) {
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: a.userId },
    action: a.action,
    eventId: a.eventId,
    detail: { count: a.count },
  }).run();
}

/** Everyone's active card, with its live link. Returns live tokens, so callers are restricted and audited like an export. */
async function activeCards(c: AppContext, eventId: string, registrationIds?: string[]) {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.first_name, p.last_name, r.kind,
            cr.short_code, cr.token_ciphertext, cr.issued_at, cr.printed_at
       FROM registrations r
       JOIN people p ON p.id = r.person_id
       JOIN credentials cr ON cr.registration_id = r.id AND cr.status = 'active'
      WHERE r.event_id = ? AND r.status = 'active'`,
  )
    .bind(eventId)
    .all<Record<string, string>>();
  // Participants first, then by name (sorted here: names are encrypted in the database).
  sortByName(results).sort((a, b) => compareText(b.kind, a.kind));
  const wanted = registrationIds ? new Set(registrationIds) : null;
  const rows = results.filter((r) => !wanted || wanted.has(r.id!));

  const origin = new URL(c.req.url).origin;
  return Promise.all(
    rows.map(async (r) => ({
      registrationId: r.id!,
      // First name and last name (or initial), as printed on the lanyard.
      name: `${r.first_name} ${r.last_name}`.trim(),
      firstName: r.first_name!,
      lastName: r.last_name!,
      kind: r.kind!,
      style: roleStyle(r.kind!),
      shortCode: formatShortCode(r.short_code!),
      qr: credentialUrl(origin, await decryptToken(c.env, r.token_ciphertext!)),
      issuedAt: r.issued_at!,
      printedAt: r.printed_at ?? null,
    })),
  );
}

/** Cards for printing. */
rosterRoutes.post('/credentials/print', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const user = requireUser(c);
  const { registrationIds, view } = await parseBody(
    c,
    z.strictObject({ registrationIds: z.array(z.uuid()).max(2000).optional(), /** Shown on screen (a person's page), not printed. */ view: z.boolean().optional() }),
  );
  const cards = await activeCards(c, eventId, registrationIds);
  await auditStatementRun(c, { action: view ? 'credentials.view' : 'credentials.print', eventId, userId: user.userId, count: cards.length });
  return c.json({ cards });
});

/** Mark lanyards as printed (after their PDF is downloaded), or as not printed again. */
rosterRoutes.post('/credentials/printed', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const { registrationIds, printed } = await parseBody(c, z.strictObject({ registrationIds: z.array(z.uuid()).min(1).max(2000), printed: z.boolean() }));
  const at = printed ? nowIso() : null;
  for (let i = 0; i < registrationIds.length; i += 90) {
    const ids = registrationIds.slice(i, i + 90);
    await c.env.DB.prepare(`UPDATE credentials SET printed_at = ? WHERE event_id = ? AND status = 'active' AND registration_id IN (${ids.map(() => '?').join(',')})`)
      .bind(at, eventId, ...ids)
      .run();
  }
  return c.json({ ok: true, printedAt: at });
});

/**
 * Each person's own page link (the same link as the QR on their lanyard),
 * for sending out by email. Live tokens, so restricted and audited like printing.
 */
rosterRoutes.post('/credentials/links', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const user = requireUser(c);
  await parseBody(c, z.strictObject({}));
  const cards = await activeCards(c, eventId);
  await auditStatementRun(c, { action: 'credentials.links', eventId, userId: user.userId, count: cards.length });
  return c.json({
    links: cards.map((x) => ({ registrationId: x.registrationId, name: x.name, kind: x.kind, shortCode: x.shortCode, link: x.qr })),
  });
});
