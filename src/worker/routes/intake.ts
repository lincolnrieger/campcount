import { Hono } from 'hono';
import { isHealthExtra } from '../../shared/consent2go';
import type { IntakePerson, IntakeSource, IntakeState } from '../../shared/intake';
import { CHECKLIST, SOURCE_NAME, intakeCheckSchema, intakeSeenSchema, intakeSyncSchema, isReviewColumn } from '../../shared/intake';
import { isEditable } from '../../shared/lifecycle';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { parseExtra } from '../services/import';
import { can } from '../services/principal';
import { rowStatements } from '../services/rosterWrites';
import { getEventRow } from './events';
import { namesLockedElsewhere, runInBatches } from './roster';

/**
 * Import & check (People › Import & check). The browser reads the MyScout
 * and Consent2Go exports; this keeps, per person and source, fingerprints of
 * what the files said (never the values), and each person's check. A later
 * upload of either file shows only people who are new, changed, or have
 * since appeared in the other system.
 */
export const intakeRoutes = new Hono<AppEnv>();

async function editableEvent(c: AppContext, eventId: string) {
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to change the roster.');
  return event;
}

const key = (m: string) => m.trim().toUpperCase();

function parseFields(json: string | null): Record<string, string> | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Section, group and dietary columns whose fingerprint differs (added, removed or changed). */
function diff(source: IntakeSource, before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => isReviewColumn(source, k)));
  return [...keys].filter((k) => before[k] !== after[k]).sort();
}

async function board(c: AppContext, eventId: string): Promise<{ people: IntakePerson[]; lastUpload: Record<IntakeSource, string | null> }> {
  const principal = c.get('principal')!;
  const withDietary = can(principal, 'dietary.view_detail', { eventId });
  const withPhoto = can(principal, 'photo.view_status', { eventId });
  const [sightings, checks, roster, dietary] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT member_number, source, name, section, group_name, fields, first_seen_at, last_seen_at FROM intake_sightings WHERE event_id = ?`).bind(eventId),
    c.env.DB.prepare(
      `SELECT k.member_number, k.myscout_fields, k.consent2go_fields, k.checklist, k.complete, k.left_off, k.checked_at, COALESCE(u.display_name, '') AS checked_by
         FROM intake_checks k LEFT JOIN users u ON u.id = k.checked_by WHERE k.event_id = ?`,
    ).bind(eventId),
    c.env.DB.prepare(
      `SELECT r.id, p.member_number, p.first_name, p.preferred_name, p.last_name, r.kind, r.section, r.group_name, r.photo_consent, r.status, r.extra_fields,
              r.position, r.role_label, r.team, r.source_status
         FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ?`,
    ).bind(eventId),
    c.env.DB.prepare(`SELECT registration_id, category, item, severity, note FROM dietary_entries WHERE event_id = ? ORDER BY created_at`).bind(eventId),
  ]);
  type Sighting = { member_number: string; source: IntakeSource; name: string; section: string; group_name: string; fields: string; first_seen_at: string; last_seen_at: string };
  type Check = { member_number: string; myscout_fields: string | null; consent2go_fields: string | null; checklist: string; complete: number; left_off: number; checked_at: string; checked_by: string };
  type Reg = { id: string; member_number: string; first_name: string; preferred_name: string; last_name: string; kind: 'youth' | 'adult'; section: string; group_name: string; photo_consent: string; status: 'active' | 'withdrawn'; extra_fields: string; position: string; role_label: string; team: string; source_status: string };
  type Diet = { registration_id: string; category: string; item: string; severity: string; note: string };

  const seen = new Map<string, Partial<Record<IntakeSource, Sighting>>>();
  const lastUpload: Record<IntakeSource, string | null> = { myscout: null, consent2go: null };
  for (const s of sightings!.results as Sighting[]) {
    const e = seen.get(key(s.member_number)) ?? {};
    e[s.source] = s;
    seen.set(key(s.member_number), e);
    if (!lastUpload[s.source] || s.last_seen_at > lastUpload[s.source]!) lastUpload[s.source] = s.last_seen_at;
  }
  const checkBy = new Map((checks!.results as Check[]).map((k) => [key(k.member_number), k]));
  const regBy = new Map((roster!.results as Reg[]).map((r) => [key(r.member_number), r]));
  const dietBy = new Map<string, Diet[]>();
  if (withDietary)
    for (const d of dietary!.results as Diet[]) {
      const list = dietBy.get(d.registration_id) ?? [];
      list.push(d);
      dietBy.set(d.registration_id, list);
    }

  const all = new Set([...seen.keys(), ...regBy.keys()]);
  const people: IntakePerson[] = [];
  for (const k of all) {
    const s = seen.get(k) ?? {};
    const reg = regBy.get(k);
    const chk = checkBy.get(k);
    const first = s.myscout ?? s.consent2go;
    const changed: string[] = [];
    if (chk) {
      for (const source of ['myscout', 'consent2go'] as const) {
        const now = s[source];
        if (!now) continue;
        const then = parseFields(source === 'myscout' ? chk.myscout_fields : chk.consent2go_fields);
        if (then === null) changed.push(`Now in ${SOURCE_NAME[source]}`);
        else for (const col of diff(source, then, parseFields(now.fields) ?? {})) changed.push(`${SOURCE_NAME[source]}: ${col}`);
      }
    }
    let state: IntakeState;
    if (!first) state = 'roster_only';
    else if (!chk) state = 'new';
    else if (changed.length) state = 'changed';
    else if (chk.left_off) state = 'left_off';
    else if (!chk.complete) state = 'in_progress';
    else state = 'checked';
    const extra = reg ? parseExtra(reg.extra_fields) : {};
    people.push({
      memberNumber: reg?.member_number ?? first!.member_number,
      name: reg ? `${reg.preferred_name || reg.first_name} ${reg.last_name}` : first!.name,
      section: reg?.section ?? first?.section ?? '',
      groupName: reg?.group_name ?? first?.group_name ?? '',
      myscout: s.myscout ? { firstSeen: s.myscout.first_seen_at, lastSeen: s.myscout.last_seen_at } : null,
      consent2go: s.consent2go ? { firstSeen: s.consent2go.first_seen_at, lastSeen: s.consent2go.last_seen_at } : null,
      roster: reg
        ? {
            registrationId: reg.id,
            status: reg.status,
            firstName: reg.first_name,
            preferredName: reg.preferred_name,
            lastName: reg.last_name,
            kind: reg.kind,
            section: reg.section,
            groupName: reg.group_name,
            position: reg.position,
            roleLabel: reg.role_label,
            team: reg.team,
            sourceStatus: reg.source_status,
            photoConsent: withPhoto ? reg.photo_consent : '',
            ...(withDietary ? { dietary: (dietBy.get(reg.id) ?? []).map(({ category, item, severity, note }) => ({ category, item, severity, note })) } : {}),
            extra: Object.fromEntries(Object.entries(extra).filter(([n]) => withDietary || !isHealthExtra(n))),
          }
        : null,
      check: chk ? { at: chk.checked_at, by: chk.checked_by, checklist: JSON.parse(chk.checklist || '{}') as Record<string, boolean>, complete: chk.complete === 1, leftOff: chk.left_off === 1 } : null,
      state,
      changed,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return { people, lastUpload };
}

intakeRoutes.get('/', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'roster.import', { eventId });
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  const row = await c.env.DB.prepare(`SELECT fingerprint_key FROM events WHERE id = ?`).bind(eventId).first<{ fingerprint_key: string }>();
  return c.json({
    ...(await board(c, eventId)),
    fingerprintKey: row!.fingerprint_key,
    dietaryEnabled: event.feature_dietary === 1,
    canEditDietary: can(principal, 'dietary.edit', { eventId }) && event.feature_dietary === 1,
    editable: isEditable(event.status),
    checklist: CHECKLIST,
  });
});

/** Record who an uploaded file lists (fingerprints only). Sent in chunks by the browser. */
intakeRoutes.post('/seen', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const { source, people } = await parseBody(c, intakeSeenSchema);
  const now = nowIso();
  await runInBatches(
    c.env.DB,
    people.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO intake_sightings (event_id, member_number, source, name, section, group_name, fields, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id, member_number, source) DO UPDATE SET
           name = excluded.name, section = excluded.section, group_name = excluded.group_name,
           fields = excluded.fields, last_seen_at = excluded.last_seen_at`,
      ).bind(eventId, key(p.memberNumber), source, p.name, p.section, p.groupName, JSON.stringify(p.fields), now, now),
    ),
  );
  await auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'intake.upload', eventId, targetType: 'event', targetId: eventId, detail: { source, people: people.length } }).run();
  return c.json({ ok: true });
});

/**
 * Keep people already on the roster up to date from each upload: names
 * (MyScout), photo consent and the swimming and medication answers
 * (Consent2Go). Section, group and dietary needs are left alone: those are
 * checked by hand.
 */
intakeRoutes.post('/sync', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const { people } = await parseBody(c, intakeSyncSchema);
  const now = nowIso();
  const locked = await namesLockedElsewhere(c, eventId, people.filter((p) => p.names).map((p) => p.memberNumber));
  const reg = `(SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND upper(p.member_number) = ?)`;
  const statements: D1PreparedStatement[] = [];
  for (const p of people) {
    const k = key(p.memberNumber);
    if (p.names && !locked.has(p.memberNumber))
      statements.push(
        c.env.DB.prepare(
          `UPDATE people SET first_name = ?, preferred_name = ?, last_name = ?, updated_at = ?
            WHERE id = (SELECT r.person_id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND upper(p.member_number) = ?)
              AND (first_name <> ? OR preferred_name <> ? OR last_name <> ?)`,
        ).bind(p.names.firstName, p.names.preferredName, p.names.lastName, now, eventId, k, p.names.firstName, p.names.preferredName, p.names.lastName),
      );
    if (p.photoConsent)
      statements.push(
        c.env.DB.prepare(`UPDATE registrations SET photo_consent = ?, updated_at = ? WHERE id = ${reg} AND photo_consent <> ?`).bind(p.photoConsent, now, eventId, k, p.photoConsent),
      );
    if (p.extra && Object.keys(p.extra).length) {
      const patch = JSON.stringify(Object.fromEntries(Object.entries(p.extra).map(([n, v]) => [n, v === '' ? null : v])));
      statements.push(c.env.DB.prepare(`UPDATE registrations SET extra_fields = json_patch(extra_fields, ?), updated_at = ? WHERE id = ${reg}`).bind(patch, now, eventId, k));
    }
  }
  statements.push(auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'intake.sync', eventId, targetType: 'event', targetId: eventId, detail: { people: people.length } }));
  await runInBatches(c.env.DB, statements);
  return c.json({ ok: true });
});

/**
 * Save one person's check: put the chosen details on the roster (unless
 * they're being left off), and remember what the files said when checked.
 */
intakeRoutes.post('/check', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  const event = await editableEvent(c, eventId);
  const input = await parseBody(c, intakeCheckSchema);
  const k = key(input.memberNumber);
  const sightings = await c.env.DB.prepare(`SELECT source FROM intake_sightings WHERE event_id = ? AND member_number = ?`).bind(eventId, k).all<{ source: string }>();
  if (sightings.results.length === 0) throw notFound();
  const complete = CHECKLIST.every((i) => input.checklist[i.key] === true) ? 1 : 0;
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  if (!input.leftOff) {
    const row = input.row;
    if (!row) throw badRequest('Choose their details first.');
    if (key(row.memberNumber) !== k) throw badRequest('That membership number doesn’t match.');
    if (row.dietary !== undefined) {
      if (event.feature_dietary !== 1) throw badRequest('Dietary requirements are switched off for this event.');
      if (!can(principal, 'dietary.edit', { eventId })) throw forbidden();
    }
    const current = await c.env.DB.prepare(
      `SELECT p.member_number, r.dietary_source_hash FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND upper(p.member_number) = ?`,
    )
      .bind(eventId, k)
      .first<{ member_number: string; dietary_source_hash: string | null }>();
    // Keep the spelling of the membership number already on file.
    const chosen = { ...row, memberNumber: current?.member_number ?? row.memberNumber };
    const pending = chosen.dietary === undefined && chosen.dietaryFingerprint !== null && chosen.dietaryFingerprint !== (current?.dietary_source_hash ?? null);
    const locked = await namesLockedElsewhere(c, eventId, [chosen.memberNumber]);
    statements.push(...rowStatements(c.env.DB, eventId, chosen, pending, now, user.userId, { keepExistingNames: locked.has(chosen.memberNumber) }));
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO intake_checks (event_id, member_number, myscout_fields, consent2go_fields, checklist, complete, left_off, checked_at, checked_by)
       VALUES (?1, ?2,
               (SELECT fields FROM intake_sightings WHERE event_id = ?1 AND member_number = ?2 AND source = 'myscout'),
               (SELECT fields FROM intake_sightings WHERE event_id = ?1 AND member_number = ?2 AND source = 'consent2go'),
               ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (event_id, member_number) DO UPDATE SET
         myscout_fields = excluded.myscout_fields, consent2go_fields = excluded.consent2go_fields, checklist = excluded.checklist,
         complete = excluded.complete, left_off = excluded.left_off, checked_at = excluded.checked_at, checked_by = excluded.checked_by`,
    ).bind(eventId, k, JSON.stringify(input.checklist), complete, input.leftOff ? 1 : 0, now, user.userId),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: input.leftOff ? 'intake.left_off' : 'intake.check',
      eventId,
      targetType: 'member',
      targetId: k,
      detail: { complete: complete === 1, dietary: input.row?.dietary?.length ?? null },
    }),
  );
  await runInBatches(c.env.DB, statements);
  const { people } = await board(c, eventId);
  return c.json({ person: people.find((p) => key(p.memberNumber) === k) ?? null });
});

/**
 * Forget uploads: one source's sightings, or both and every check (start
 * over). People already put on the roster stay there.
 */
intakeRoutes.delete('/uploads', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const which = c.req.query('source');
  if (which !== 'myscout' && which !== 'consent2go' && which !== 'all') throw badRequest('Say which uploads to clear.');
  await c.env.DB.batch([
    which === 'all'
      ? c.env.DB.prepare(`DELETE FROM intake_sightings WHERE event_id = ?`).bind(eventId)
      : c.env.DB.prepare(`DELETE FROM intake_sightings WHERE event_id = ? AND source = ?`).bind(eventId, which),
    ...(which === 'all' ? [c.env.DB.prepare(`DELETE FROM intake_checks WHERE event_id = ?`).bind(eventId)] : []),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'intake.clear', eventId, targetType: 'event', targetId: eventId, detail: { which } }),
  ]);
  return c.json({ ok: true });
});

/** Undo a check, so the person shows as needing a look again. */
intakeRoutes.delete('/check/:memberNumber', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.import', { eventId });
  const user = requireUser(c);
  await editableEvent(c, eventId);
  const k = key(c.req.param('memberNumber'));
  if (!/^[A-Z0-9-]{1,20}$/.test(k)) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM intake_checks WHERE event_id = ? AND member_number = ?`).bind(eventId, k),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'intake.uncheck', eventId, targetType: 'member', targetId: k, onlyIfChanged: true }),
  ]);
  return c.json({ ok: true });
});
