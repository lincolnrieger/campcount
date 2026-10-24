import { Hono } from 'hono';
import { z } from 'zod';
import { credentialUrl, formatShortCode } from '../../shared/credentials';
import { displayName } from '../../shared/names';
import { isEditable } from '../../shared/lifecycle';
import type { ImportRow } from '../../shared/schemas';
import { dietaryUpdateSchema, importRequestSchema, registrationPatchSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { decryptToken, issueStatements } from '../services/credentials';
import type { ExistingRegistration } from '../services/import';
import { duplicateMemberNumbers, planImport } from '../services/import';
import { can } from '../services/principal';
import { getEventRow } from './events';
import { loadEventModel, whereabouts } from '../services/reports';

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
  const principal = requirePermission(c, 'roster.view', { eventId });
  const withDietary = can(principal, 'dietary.view_detail', { eventId });
  const withPhoto = can(principal, 'photo.view_status', { eventId });

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name,
            r.position, r.role_label, r.photo_consent, r.status, r.dietary_source_hash,
            (SELECT short_code FROM credentials cr WHERE cr.registration_id = r.id AND cr.status = 'active') AS short_code
       FROM registrations r JOIN people p ON p.id = r.person_id
      WHERE r.event_id = ?
      ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
  )
    .bind(eventId)
    .all<Record<string, string | null>>();

  const dietary = new Map<string, unknown[]>();
  if (withDietary) {
    const rows = await c.env.DB.prepare(
      `SELECT registration_id, category, item, severity, note FROM dietary_entries WHERE event_id = ? ORDER BY created_at`,
    )
      .bind(eventId)
      .all<{ registration_id: string; category: string; item: string; severity: string; note: string }>();
    for (const d of rows.results) {
      const list = dietary.get(d.registration_id) ?? [];
      list.push({ category: d.category, item: d.item, severity: d.severity, note: d.note });
      dietary.set(d.registration_id, list);
    }
  }

  return c.json({
    registrations: results.map((r) => ({
      id: r.id,
      memberNumber: r.member_number,
      firstName: r.first_name,
      preferredName: r.preferred_name,
      lastName: r.last_name,
      displayName: displayName(r.first_name!, r.preferred_name!, r.last_name!),
      kind: r.kind,
      section: r.section,
      groupName: r.group_name,
      position: r.position,
      roleLabel: r.role_label,
      status: r.status,
      shortCode: r.short_code ? formatShortCode(r.short_code) : null,
      ...(withPhoto ? { photoConsent: r.photo_consent } : {}),
      ...(withDietary ? { dietary: dietary.get(r.id!) ?? [], dietaryFingerprint: r.dietary_source_hash } : {}),
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
    `SELECT r.id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name, r.position,
            r.role_label, r.team, r.photo_consent, r.status, r.created_at, r.updated_at,
            (SELECT short_code FROM credentials cr WHERE cr.registration_id = r.id AND cr.status = 'active') AS short_code
       FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.id = ? AND r.event_id = ?`,
  )
    .bind(id, eventId)
    .first<Record<string, string | null>>();
  if (!r) throw notFound();
  const withDietary = can(principal, 'dietary.view_detail', { eventId });
  const withPhoto = can(principal, 'photo.view_status', { eventId });
  const [dietary, scans, model] = await Promise.all([
    withDietary
      ? c.env.DB.prepare(`SELECT category, item, severity, note FROM dietary_entries WHERE registration_id = ? ORDER BY created_at`).bind(id).all()
      : null,
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
  const outcomeOf = (scanId: string, key: string) => model.replays.get(key)?.outcomes.get(scanId);
  return c.json({
    registration: {
      id: r.id,
      memberNumber: r.member_number,
      firstName: r.first_name,
      preferredName: r.preferred_name,
      lastName: r.last_name,
      displayName: displayName(r.first_name!, r.preferred_name!, r.last_name!),
      kind: r.kind,
      section: r.section,
      groupName: r.group_name,
      position: r.position,
      roleLabel: r.role_label,
      team: r.team,
      status: r.status,
      shortCode: r.short_code ? formatShortCode(r.short_code) : null,
      ...(withPhoto ? { photoConsent: r.photo_consent } : {}),
      ...(withDietary ? { dietary: dietary!.results } : {}),
    },
    can: {
      edit: can(principal, 'roster.edit', { eventId }) && isEditable(event.status),
      editDietary: can(principal, 'dietary.edit', { eventId }) && event.feature_dietary === 1 && isEditable(event.status),
      cards: can(principal, 'credentials.manage', { eventId }),
    },
    where: whereabouts(model).get(id) ?? null,
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

  const personCols: Record<string, string> = { memberNumber: 'member_number', firstName: 'first_name', preferredName: 'preferred_name', lastName: 'last_name' };
  const regCols: Record<string, string> = { kind: 'kind', section: 'section', groupName: 'group_name', position: 'position', photoConsent: 'photo_consent', status: 'status' };
  const set = (cols: Record<string, string>) => Object.keys(input).filter((k) => k in cols && input[k as keyof typeof input] !== undefined);
  const pKeys = set(personCols);
  const rKeys = set(regCols);
  if (pKeys.length + rKeys.length === 0) return c.json({ ok: true });
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (pKeys.length) {
    statements.push(
      c.env.DB.prepare(`UPDATE people SET ${pKeys.map((k) => `${personCols[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(
        ...pKeys.map((k) => input[k as keyof typeof input] as string),
        now,
        reg.person_id,
      ),
    );
  }
  if (rKeys.length) {
    statements.push(
      c.env.DB.prepare(`UPDATE registrations SET ${rKeys.map((k) => `${regCols[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(
        ...rKeys.map((k) => input[k as keyof typeof input] as string),
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
    if (String(err).includes('UNIQUE')) throw conflict('Someone else already has that membership number.');
    throw err;
  }
  return c.json({ ok: true });
});

rosterRoutes.put('/registrations/:registrationId/dietary', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'dietary.edit', { eventId });
  const user = requireUser(c);
  const id = regParam(c.req.param('registrationId'));
  const { entries } = await parseBody(c, dietaryUpdateSchema);
  const event = await editableEvent(c, eventId);
  if (event.feature_dietary !== 1) throw conflict('Dietary requirements are switched off for this event.');
  const exists = await c.env.DB.prepare(`SELECT 1 FROM registrations WHERE id = ? AND event_id = ?`).bind(id, eventId).first();
  if (!exists) throw notFound();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM dietary_entries WHERE registration_id = ?`).bind(id),
    ...entries.map((e) =>
      c.env.DB.prepare(
        `INSERT INTO dietary_entries (id, event_id, registration_id, category, item, severity, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), eventId, id, e.category, e.item, e.severity, e.note, user.userId, now),
    ),
    c.env.DB.prepare(`UPDATE registrations SET dietary_review_pending = 0, updated_at = ? WHERE id = ?`).bind(now, id),
    // Never the values themselves.
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'dietary.update', eventId, targetType: 'registration', targetId: id, detail: { entries: entries.length } }),
  ]);
  return c.json({ ok: true });
});

/**
 * Remove someone from the event entirely: their card, dietary details,
 * bookings and every scan go too. Withdrawing keeps the records; deleting is
 * for mistakes and test data. The audit log keeps the count, not the name.
 */
rosterRoutes.delete('/registrations/:registrationId', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const id = regParam(c.req.param('registrationId'));
  await editableEvent(c, eventId);
  const reg = await c.env.DB.prepare(
    `SELECT person_id, (SELECT count(*) FROM scans s WHERE s.registration_id = r.id) AS scans FROM registrations r WHERE id = ? AND event_id = ?`,
  )
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

// ---------------------------------------------------------------- import

rosterRoutes.get('/import/context', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'roster.import', { eventId });
  const event = await editableEvent(c, eventId);
  const row = await c.env.DB.prepare(`SELECT fingerprint_key FROM events WHERE id = ?`).bind(eventId).first<{ fingerprint_key: string }>();
  const { results } = await c.env.DB.prepare(
    `SELECT p.member_number, r.dietary_source_hash FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ?`,
  )
    .bind(eventId)
    .all<{ member_number: string; dietary_source_hash: string | null }>();
  return c.json({
    fingerprintKey: row!.fingerprint_key,
    dietaryEnabled: event.feature_dietary === 1,
    canEditDietary: can(principal, 'dietary.edit', { eventId }),
    reviewedFingerprints: Object.fromEntries(results.map((r) => [r.member_number, r.dietary_source_hash])),
  });
});

async function loadExisting(db: D1Database, eventId: string): Promise<ExistingRegistration[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id AS registration_id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section,
              r.group_name, r.position, r.role_label, r.team, r.source_status, r.photo_consent, r.status, r.dietary_source_hash
         FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ?`,
    )
    .bind(eventId)
    .all<ExistingRegistration>();
  return results;
}

async function validatedImport(c: AppContext, eventId: string) {
  const input = await parseBody(c, importRequestSchema);
  const event = await editableEvent(c, eventId);
  const dupes = duplicateMemberNumbers(input.rows);
  if (dupes.length > 0) {
    throw badRequest(`These membership numbers appear more than once: ${dupes.slice(0, 10).join(', ')}.`);
  }
  if (input.rows.some((r) => r.dietary !== undefined)) {
    if (event.feature_dietary !== 1) throw badRequest('Dietary requirements are switched off for this event.');
    if (!can(c.get('principal')!, 'dietary.edit', { eventId })) throw forbidden();
  }
  const existing = await loadExisting(c.env.DB, eventId);
  return { input, plan: planImport(input.rows, existing, input.withdrawMissing) };
}

rosterRoutes.post('/import/preview', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const { plan } = await validatedImport(c, eventId);
  return c.json({ plan });
});

function rowStatements(db: D1Database, eventId: string, row: ImportRow, dietaryPending: boolean, now: string, userId: string) {
  const personRef = `(SELECT id FROM people WHERE member_number = ?)`;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO people (id, member_number, first_name, preferred_name, last_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (member_number) DO UPDATE SET
           first_name = excluded.first_name, preferred_name = excluded.preferred_name,
           last_name = excluded.last_name, updated_at = excluded.updated_at
         WHERE first_name <> excluded.first_name OR preferred_name <> excluded.preferred_name OR last_name <> excluded.last_name`,
      )
      .bind(crypto.randomUUID(), row.memberNumber, row.firstName, row.preferredName, row.lastName, now, now),
    db
      .prepare(
        `INSERT INTO registrations (id, event_id, person_id, kind, section, group_name, position, role_label, team,
            source_status, photo_consent, status, dietary_source_hash, dietary_review_pending, created_at, updated_at)
         VALUES (?, ?, ${personRef}, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
         ON CONFLICT (event_id, person_id) DO UPDATE SET
           kind = excluded.kind, section = excluded.section, group_name = excluded.group_name,
           position = excluded.position, role_label = excluded.role_label, team = excluded.team,
           source_status = excluded.source_status, photo_consent = excluded.photo_consent, status = 'active',
           dietary_source_hash = CASE WHEN ? THEN registrations.dietary_source_hash ELSE excluded.dietary_source_hash END,
           dietary_review_pending = excluded.dietary_review_pending,
           updated_at = excluded.updated_at`,
      )
      .bind(
        crypto.randomUUID(),
        eventId,
        row.memberNumber,
        row.kind,
        row.section,
        row.groupName,
        row.position,
        row.roleLabel,
        row.team,
        row.sourceStatus,
        row.photoConsent,
        // A brand-new registration with unreviewed dietary text starts with no fingerprint, so it stays flagged.
        dietaryPending ? null : row.dietaryFingerprint,
        dietaryPending ? 1 : 0,
        now,
        now,
        dietaryPending ? 1 : 0,
      ),
  ];
  if (row.dietary !== undefined) {
    const regRef = `(SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ?)`;
    statements.push(db.prepare(`DELETE FROM dietary_entries WHERE registration_id = ${regRef}`).bind(eventId, row.memberNumber));
    for (const d of row.dietary) {
      statements.push(
        db
          .prepare(
            `INSERT INTO dietary_entries (id, event_id, registration_id, category, item, severity, note, created_by, created_at)
             VALUES (?, ?, ${regRef}, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), eventId, eventId, row.memberNumber, d.category, d.item, d.severity, d.note, userId, now),
      );
    }
  }
  return statements;
}

/**
 * Apply an import. Every statement is an idempotent upsert keyed on
 * membership number, so if a large import is interrupted part-way, running
 * the same import again completes it without duplicating anything.
 */
rosterRoutes.post('/import/commit', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  const { input, plan } = await validatedImport(c, eventId);
  const now = nowIso();

  const statements: D1PreparedStatement[] = [];
  input.rows.forEach((row, i) => {
    if (plan.rows[i]!.action === 'unchanged') return;
    statements.push(...rowStatements(c.env.DB, eventId, row, plan.rows[i]!.dietaryPending, now, user.userId));
  });
  for (const w of plan.withdraw) {
    statements.push(
      c.env.DB.prepare(`UPDATE registrations SET status = 'withdrawn', updated_at = ? WHERE id = ? AND event_id = ?`).bind(
        now,
        w.registrationId,
        eventId,
      ),
    );
  }
  await runInBatches(c.env.DB, statements);

  const jobId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO import_jobs (id, event_id, created_by, created_at, source_label, rows_received, created_count,
          updated_count, unchanged_count, withdrawn_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      jobId,
      eventId,
      user.userId,
      now,
      input.sourceLabel,
      input.rows.length,
      plan.counts.create,
      plan.counts.update,
      plan.counts.unchanged,
      plan.counts.withdraw,
    ),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'roster.import',
      eventId,
      targetType: 'import_job',
      targetId: jobId,
      detail: { ...plan.counts, rows: input.rows.length },
    }),
  ]);
  return c.json({ jobId, counts: plan.counts });
});

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

/** Cards for printing. Returns live tokens, so it is restricted and audited like an export. */
rosterRoutes.post('/credentials/print', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const user = requireUser(c);
  const { registrationIds } = await parseBody(c, z.strictObject({ registrationIds: z.array(z.uuid()).max(2000).optional() }));

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name,
            cr.short_code, cr.token_ciphertext
       FROM registrations r
       JOIN people p ON p.id = r.person_id
       JOIN credentials cr ON cr.registration_id = r.id AND cr.status = 'active'
      WHERE r.event_id = ? AND r.status = 'active'
      ORDER BY r.kind DESC, r.group_name COLLATE NOCASE, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`,
  )
    .bind(eventId)
    .all<Record<string, string>>();
  const wanted = registrationIds ? new Set(registrationIds) : null;
  const rows = results.filter((r) => !wanted || wanted.has(r.id!));

  const origin = new URL(c.req.url).origin;
  const cards = await Promise.all(
    rows.map(async (r) => ({
      registrationId: r.id,
      name: displayName(r.first_name!, r.preferred_name!, r.last_name!),
      kind: r.kind,
      section: r.section,
      groupName: r.group_name,
      shortCode: formatShortCode(r.short_code!),
      qr: credentialUrl(origin, await decryptToken(c.env, r.token_ciphertext!)),
    })),
  );
  await auditStatementRun(c, { action: 'credentials.print', eventId, userId: user.userId, count: cards.length });
  return c.json({ cards });
});
