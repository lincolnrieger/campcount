import { Hono } from 'hono';
import { z } from 'zod';
import { credentialUrl, formatShortCode, memberCardCode } from '../../shared/credentials';
import { displayName } from '../../shared/names';
import { isEditable } from '../../shared/lifecycle';
import { dietaryUpdateSchema, importRequestSchema, personEntrySchema, registrationPatchSchema } from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { decryptToken, issueStatements } from '../services/credentials';
import type { ExistingRegistration } from '../services/import';
import { duplicateMemberNumbers, parseExtra, planImport, storeExtra } from '../services/import';
import { can } from '../services/principal';
import { getEventRow } from './events';
import { loadEventModel, whereabouts } from '../services/reports';
import type { ImportRow } from '../../shared/schemas';
import { isHealthExtra } from '../../shared/consent2go';
import { loadSections } from '../services/sections';
import { normalizeSection, sectionStyle } from '../../shared/sections';
import { addToRoster, guestNumber, rowStatements, syncKindsStatement, toImportRow } from '../services/rosterWrites';

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
            r.position, r.role_label, r.photo_consent, r.status, r.dietary_source_hash, r.dietary_checked,
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
      carRego: r.car_rego,
      shortCode: r.short_code ? formatShortCode(r.short_code) : null,
      ...(withPhoto ? { photoConsent: r.photo_consent } : {}),
      ...(withDietary
        ? { dietary: dietary.get(r.id!) ?? [], dietaryFingerprint: r.dietary_source_hash, dietaryChecked: r.dietary_checked ? (JSON.parse(r.dietary_checked) as string[]) : null }
        : {}),
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
            r.role_label, r.team, r.photo_consent, r.status, r.created_at, r.updated_at, r.extra_fields, r.car_rego,
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
      // Medication permissions and the like are health information: only for people who see dietary detail.
      extra: Object.fromEntries(Object.entries(parseExtra(r.extra_fields)).filter(([k]) => withDietary || !isHealthExtra(k))),
      status: r.status,
      carRego: r.car_rego,
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
  if (input.section !== undefined) input.section = normalizeSection(input.section, await loadSections(c.env.DB, eventId));
  const reg = await c.env.DB.prepare(`SELECT person_id FROM registrations WHERE id = ? AND event_id = ?`).bind(id, eventId).first<{ person_id: string }>();
  if (!reg) throw notFound();

  const personCols: Record<string, string> = { memberNumber: 'member_number', firstName: 'first_name', preferredName: 'preferred_name', lastName: 'last_name' };
  const regCols: Record<string, string> = { kind: 'kind', section: 'section', groupName: 'group_name', position: 'position', photoConsent: 'photo_consent', status: 'status', carRego: 'car_rego' };
  const set = (cols: Record<string, string>) => Object.keys(input).filter((k) => k in cols && input[k as keyof typeof input] !== undefined);
  const pKeys = set(personCols);
  const rKeys = set(regCols);
  if (pKeys.length + rKeys.length === 0 && input.extra === undefined) return c.json({ ok: true });
  if (pKeys.length) {
    const sharedWith = await c.env.DB.prepare(`SELECT DISTINCT event_id FROM registrations WHERE person_id = ? AND event_id <> ?`)
      .bind(reg.person_id, eventId)
      .all<{ event_id: string }>();
    if (sharedWith.results.some((r) => !can(c.get('principal')!, 'roster.edit', { eventId: r.event_id }))) {
      throw conflict(
        'This person is also on another camp, so their name and membership number can only be changed by someone who runs both camps. Correct it in MyScout and import again.',
      );
    }
  }
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
  // The lanyard's typed code is the membership number: keep it in step (the QR doesn't change).
  const newCode = input.memberNumber !== undefined ? memberCardCode(input.memberNumber) : null;
  if (newCode) {
    statements.push(c.env.DB.prepare(`UPDATE credentials SET short_code = ? WHERE registration_id = ? AND status = 'active'`).bind(newCode, id));
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
  if (input.extra !== undefined) {
    statements.push(c.env.DB.prepare(`UPDATE registrations SET extra_fields = ?, updated_at = ? WHERE id = ?`).bind(storeExtra(input.extra), now, id));
  }
  // Youth or adult follows the section and the camp's setting.
  if (rKeys.includes('section') || rKeys.includes('kind')) statements.push(syncKindsStatement(c.env.DB, eventId));
  statements.push(
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'registration.update',
      eventId,
      targetType: 'registration',
      targetId: id,
      detail: { fields: [...pKeys, ...rKeys, ...(input.extra !== undefined ? ['extra'] : [])].join(',') },
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
  const { entries, checkedNotes } = await parseBody(c, dietaryUpdateSchema);
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
    // Checked: which notes were read (from Import & check), or just that someone has (edited elsewhere).
    c.env.DB.prepare(`UPDATE registrations SET dietary_review_pending = 0, dietary_checked = COALESCE(?, dietary_checked, '["*"]'), updated_at = ? WHERE id = ?`).bind(
      checkedNotes ? JSON.stringify(checkedNotes) : null,
      now,
      id,
    ),
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

/** An event manager adds someone by hand. They join the roster straight away, with a card. */
rosterRoutes.post('/registrations', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const user = requireUser(c);
  const e = await editableEvent(c, eventId);
  const input = await parseBody(c, personEntrySchema);
  const memberNumber = input.memberNumber?.toUpperCase() ?? guestNumber();
  const already = await c.env.DB.prepare(
    `SELECT 1 FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ? AND r.status = 'active'`,
  )
    .bind(e.id, memberNumber)
    .first();
  if (already) throw conflict('Someone with that membership number is already on this event.');
  const registrationId = await addToRoster(
    c.env,
    e.id,
    toImportRow({ ...input, memberNumber, dietary: e.feature_dietary ? input.dietary : [] }),
    user.userId,
    (await namesLockedElsewhere(c, e.id, [memberNumber])).has(memberNumber),
  );
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'registration.add',
    eventId: e.id,
    targetType: 'registration',
    targetId: registrationId,
  }).run();
  return c.json({ registrationId }, 201);
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
              r.group_name, r.position, r.role_label, r.team, r.source_status, r.photo_consent, r.status, r.dietary_source_hash,
              r.extra_fields
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
  // Sections are filed under the camp's own names (Settings › Sections).
  const sections = await loadSections(c.env.DB, eventId);
  input.rows = input.rows.map((r) => ({ ...r, section: normalizeSection(r.section, sections) }));
  const existing = await loadExisting(c.env.DB, eventId);
  if (input.source === 'consent2go') {
    input.withdrawMissing = false;
    input.rows = input.rows.map((row) => mergeConsent2Go(row, existing));
  }
  return { input, plan: planImport(input.rows, existing, input.withdrawMissing) };
}

/**
 * A Consent2Go row for someone already on the camp (from MyScout): keep who
 * they are as MyScout has it, and take only what Consent2Go adds (photo
 * consent, dietary needs, extra details). Blanks in Consent2Go never wipe
 * what's already there.
 */
function mergeConsent2Go(row: ImportRow, existing: ExistingRegistration[]): ImportRow {
  const current = existing.find((e) => e.member_number.toUpperCase() === row.memberNumber.toUpperCase());
  if (!current) return row;
  const extra = row.extra ? Object.fromEntries(Object.entries(row.extra).filter(([, v]) => v !== '')) : undefined;
  return {
    ...row,
    memberNumber: current.member_number,
    firstName: current.first_name,
    preferredName: current.preferred_name,
    lastName: current.last_name,
    kind: current.kind as ImportRow['kind'],
    section: current.section as ImportRow['section'],
    groupName: current.group_name,
    position: current.position,
    roleLabel: current.role_label,
    team: current.team,
    sourceStatus: current.source_status,
    photoConsent: row.photoConsent === 'unknown' ? (current.photo_consent as ImportRow['photoConsent']) : row.photoConsent,
    // No dietary text in Consent2Go: leave what's recorded alone (don't ask for a review).
    dietaryFingerprint: row.dietaryFingerprint ?? current.dietary_source_hash,
    ...(extra && Object.keys(extra).length ? { extra } : { extra: undefined }),
  };
}

/**
 * People records are shared between camps (one per membership number). A
 * camp's team may only change a shared person's names if they can also edit
 * every other camp that person is on; otherwise one camp could rename a child
 * on another camp's roster and lanyards. Returns the membership numbers whose
 * names this caller must leave alone.
 */
async function namesLockedElsewhere(c: AppContext, eventId: string, memberNumbers: string[]): Promise<Set<string>> {
  const principal = c.get('principal')!;
  const distinct = [...new Set(memberNumbers)];
  const locked = new Set<string>();
  for (let i = 0; i < distinct.length; i += 90) {
    const chunk = distinct.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT p.member_number, r.event_id FROM people p JOIN registrations r ON r.person_id = p.id
        WHERE r.event_id <> ? AND p.member_number IN (${chunk.map(() => '?').join(', ')})`,
    )
      .bind(eventId, ...chunk)
      .all<{ member_number: string; event_id: string }>();
    for (const r of results) if (!can(principal, 'roster.edit', { eventId: r.event_id })) locked.add(r.member_number);
  }
  return locked;
}

rosterRoutes.post('/import/preview', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const { plan } = await validatedImport(c, eventId);
  return c.json({ plan });
});


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
  const locked = await namesLockedElsewhere(c, eventId, input.rows.map((r) => r.memberNumber));
  input.rows.forEach((row, i) => {
    if (plan.rows[i]!.action === 'unchanged') return;
    statements.push(
      ...rowStatements(c.env.DB, eventId, row, plan.rows[i]!.dietaryPending, now, user.userId, {
        keepExistingNames: locked.has(row.memberNumber),
      }),
    );
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
  statements.push(syncKindsStatement(c.env.DB, eventId));
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

/** Everyone's active card, with its live link. Returns live tokens, so callers are restricted and audited like an export. */
async function activeCards(c: AppContext, eventId: string, registrationIds?: string[]) {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name, r.photo_consent,
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
  const event = await c.env.DB.prepare(`SELECT feature_photo FROM events WHERE id = ?`).bind(eventId).first<{ feature_photo: number }>();
  const photos = event?.feature_photo === 1 && can(c.get('principal')!, 'photo.view_status', { eventId });
  const sections = await loadSections(c.env.DB, eventId);
  return Promise.all(
    rows.map(async (r) => ({
      registrationId: r.id!,
      // Preferred name and full surname, as printed on the lanyard.
      name: `${r.preferred_name || r.first_name} ${r.last_name}`.trim(),
      firstName: r.preferred_name || r.first_name!,
      lastName: r.last_name!,
      kind: r.kind!,
      section: r.section!,
      groupName: r.group_name!,
      style: sectionStyle(sections, r.section!),
      shortCode: formatShortCode(r.short_code!),
      // Anyone without a "yes" is treated as no consent, the same as at the scanner.
      noPhotos: photos && r.photo_consent !== 'yes',
      qr: credentialUrl(origin, await decryptToken(c.env, r.token_ciphertext!)),
    })),
  );
}

/** Cards for printing. */
rosterRoutes.post('/credentials/print', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'credentials.manage', { eventId });
  const user = requireUser(c);
  const { registrationIds } = await parseBody(c, z.strictObject({ registrationIds: z.array(z.uuid()).max(2000).optional() }));
  const cards = await activeCards(c, eventId, registrationIds);
  await auditStatementRun(c, { action: 'credentials.print', eventId, userId: user.userId, count: cards.length });
  return c.json({ cards });
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
    links: cards.map((x) => ({ registrationId: x.registrationId, name: x.name, kind: x.kind, section: x.section, groupName: x.groupName, shortCode: x.shortCode, link: x.qr })),
  });
});
