import { Hono } from 'hono';
import { compareText, sortByName } from '../lib/sort';
import { z } from 'zod';
import type { Permission } from '../../shared/permissions';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { devices, loadEventModel, loadEventModelForDashboard, localTime, openItems, summarise, toCsv, whereabouts } from '../services/reports';
import { can } from '../services/principal';
import type { EventRow } from './events';
import { getEventRow } from './events';
import { leaderboard } from '../services/sideQuest';

export const reportRoutes = new Hono<AppEnv>();

async function event(c: AppContext, eventId: string): Promise<EventRow> {
  const row = await getEventRow(c.env.DB, eventId);
  if (!row) throw notFound();
  return row;
}

reportRoutes.get('/live', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'reports.view', { eventId });
  const ev = await event(c, eventId);
  const model = await loadEventModelForDashboard(c.env.DB, eventId, ev.feature_site === 1, c.req.query('fresh') !== undefined);
  // People still signed in is normal during camp; only flag what needs a person to look.
  const items = openItems(model).filter((i) => i.kind !== 'still_present');
  return c.json({
    generatedAt: nowIso(),
    timezone: ev.timezone,
    ...summarise(model),
    openItems: items.length,
    devices: devices(model),
  });
});

/** Side Quest: who has collected the most people (for prizes). Staff only; participants only ever see first names and counts. */
reportRoutes.get('/side-quest', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'reports.view', { eventId });
  const ev = await event(c, eventId);
  return c.json({ enabled: ev.feature_side_quest === 1, ...(await leaderboard(c.env.DB, eventId)) });
});

/**
 * Every Side Quest collection (who collected whom, and when), with the names
 * of the people in it, for the staff Side Quest page: the full leaderboard,
 * who has made friends with whom, and spotting ones that look made up.
 */
reportRoutes.get('/side-quest/collections', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'reports.view', { eventId });
  const ev = await event(c, eventId);
  const [rows, people] = await Promise.all([
    // Only young people play: collections by or of a leader (from before that rule) don't count.
    c.env.DB.prepare(
      `SELECT c.collector_id, c.collected_id, c.created_at FROM side_quest_collections c
         JOIN registrations a ON a.id = c.collector_id AND a.kind = 'youth'
         JOIN registrations b ON b.id = c.collected_id AND b.kind = 'youth'
        WHERE c.event_id = ? ORDER BY c.created_at LIMIT 20000`,
    )
      .bind(eventId)
      .all<{ collector_id: string; collected_id: string; created_at: string }>(),
    c.env.DB.prepare(
      `SELECT r.id, p.first_name, p.last_name, r.level, r.group_name, r.kind, r.status FROM registrations r JOIN people p ON p.id = r.person_id
        WHERE r.event_id = ? AND r.id IN (SELECT collector_id FROM side_quest_collections WHERE event_id = ?1 UNION SELECT collected_id FROM side_quest_collections WHERE event_id = ?1)`,
    )
      .bind(eventId)
      .all<{ id: string; first_name: string; last_name: string; level: string; group_name: string; kind: string; status: string }>(),
  ]);
  return c.json({
    enabled: ev.feature_side_quest === 1,
    canRemove: can(principal, 'event.configure', { eventId }),
    players: (await c.env.DB.prepare(`SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active' AND kind = 'youth'`).bind(eventId).first<{ n: number }>())?.n ?? 0,
    people: people.results.map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      level: p.level,
      groupName: p.group_name,
      kind: p.kind,
      active: p.status === 'active',
    })),
    collections: rows.results.map((r) => ({ collectorId: r.collector_id, collectedId: r.collected_id, at: r.created_at })),
  });
});

const collectionPairs = z.array(z.strictObject({ collectorId: z.uuid(), collectedId: z.uuid() })).min(1).max(500);

/** Take away collections that shouldn't count (a photo of a lanyard, a stack of spare cards). */
reportRoutes.post('/side-quest/collections/remove', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.configure', { eventId });
  const user = requireUser(c);
  const { pairs } = await parseBody(c, z.strictObject({ pairs: collectionPairs }));
  const removed = await c.env.DB.batch(
    pairs.map((p) =>
      c.env.DB.prepare(`DELETE FROM side_quest_collections WHERE event_id = ? AND collector_id = ? AND collected_id = ? RETURNING created_at`).bind(eventId, p.collectorId, p.collectedId),
    ),
  );
  const gone = pairs
    .map((p, i) => ({ ...p, at: (removed[i]?.results?.[0] as { created_at?: string } | undefined)?.created_at }))
    .filter((p): p is typeof p & { at: string } => !!p.at);
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'side_quest.remove',
    eventId,
    targetType: 'event',
    targetId: eventId,
    detail: { count: gone.length },
  }).run();
  return c.json({ removed: gone });
});

/** Put back collections just taken away (Undo). Only between people still on this camp. */
reportRoutes.post('/side-quest/collections/restore', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'event.configure', { eventId });
  const user = requireUser(c);
  const { items } = await parseBody(
    c,
    z.strictObject({ items: z.array(z.strictObject({ collectorId: z.uuid(), collectedId: z.uuid(), at: z.iso.datetime() })).min(1).max(500) }),
  );
  await c.env.DB.batch(
    items.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO side_quest_collections (event_id, collector_id, collected_id, created_at)
         SELECT ?1, ?2, ?3, ?4
          WHERE ?2 <> ?3
            AND EXISTS (SELECT 1 FROM registrations WHERE id = ?2 AND event_id = ?1)
            AND EXISTS (SELECT 1 FROM registrations WHERE id = ?3 AND event_id = ?1)
         ON CONFLICT (collector_id, collected_id) DO NOTHING`,
      ).bind(eventId, p.collectorId, p.collectedId, p.at),
    ),
  );
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'side_quest.restore',
    eventId,
    targetType: 'event',
    targetId: eventId,
    detail: { count: items.length },
  }).run();
  return c.json({ ok: true });
});

/** Where everyone is right now: on or off site, which activity, and where they were last scanned. */
reportRoutes.get('/whereabouts', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'reports.view', { eventId });
  const ev = await event(c, eventId);
  const model = await loadEventModelForDashboard(c.env.DB, eventId, ev.feature_site === 1, c.req.query('fresh') !== undefined);
  const where = whereabouts(model);
  const people = [...model.people.values()]
    .filter((p) => p.status === 'active')
    .map((p) => ({
      id: p.id,
      fullName: `${p.firstName} ${p.lastName}`,
      groupName: p.groupName,
      level: p.level,
      kind: p.kind,
      ...where.get(p.id)!,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const activities = model.contexts
    .filter((ctx) => ctx.type === 'activity' && ctx.status === 'active')
    .map((ctx) => ({
      key: ctx.key,
      name: ctx.name,
      capacity: ctx.capacity,
      trackSignOut: ctx.rules.type === 'activity' && ctx.rules.trackSignOut,
      presentNow: model.replays.get(ctx.key)!.presentNow,
    }));
  return c.json({ generatedAt: nowIso(), timezone: ev.timezone, siteTracked: ev.feature_site === 1, people, activities });
});

reportRoutes.get('/reconciliation', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'reports.view', { eventId });
  const ev = await event(c, eventId);
  const model = await loadEventModel(c.env.DB, eventId, ev.feature_site === 1);
  const pendingDietary = ev.feature_dietary
    ? await c.env.DB.prepare(`SELECT count(*) AS n FROM registrations WHERE event_id = ? AND status = 'active' AND dietary_review_pending = 1`)
        .bind(eventId)
        .first<{ n: number }>()
    : null;
  return c.json({ generatedAt: nowIso(), timezone: ev.timezone, items: openItems(model), devices: devices(model), pendingDietary: pendingDietary?.n ?? 0 });
});

/**
 * Close-out helper: record a sign-out (or departure) for everyone still
 * present in a context. Each is a separate, attributed scan with a reason.
 */
reportRoutes.post('/reconciliation/sign-out-all', async (c) => {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'attendance.correct', { eventId });
  const user = requireUser(c);
  const { contextKey, reason } = await parseBody(
    c,
    z.strictObject({ contextKey: z.string().regex(/^(site:|activity:[0-9a-f-]{36}|meal:[0-9a-f-]{36})$/), reason: z.string().trim().min(3).max(200) }),
  );
  const ev = await event(c, eventId);
  if (ev.status !== 'open' && ev.status !== 'completed') throw conflict('This event is closed.');
  const model = await loadEventModel(c.env.DB, eventId, ev.feature_site === 1);
  const ctx = model.contexts.find((x) => x.key === contextKey);
  if (!ctx) throw notFound();
  if (ctx.type === 'meal') throw badRequest('Meals have nothing to sign out.');
  const present = [...model.replays.get(ctx.key)!.states].filter(([, s]) => s.present).map(([id]) => id);
  const now = nowIso();
  const statements = present.map((registrationId) =>
    c.env.DB.prepare(
      `INSERT INTO scans (id, event_id, context_type, context_id, registration_id, direction, method, device_time, server_time,
          device_id, actor_user_id, outcome, correction_reason)
       VALUES (?, ?, ?, ?, ?, 'out', 'manual', ?, ?, 'close-out', ?, 'accepted', ?)`,
    ).bind(crypto.randomUUID(), eventId, ctx.type, ctx.id, registrationId, now, now, user.userId, reason),
  );
  statements.push(
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'reconciliation.sign_out_all',
      eventId,
      targetType: ctx.type,
      targetId: ctx.id ?? 'site',
      detail: { count: present.length },
    }),
  );
  await c.env.DB.batch(statements);
  return c.json({ signedOut: present.length });
});

// ---------------------------------------------------------------- exports

const EXPORTS: Record<string, { permission: Permission; label: string }> = {
  attendance: { permission: 'reports.export', label: 'All scans' },
  'activity-summary': { permission: 'reports.export', label: 'Activity summary' },
  'meal-counts': { permission: 'reports.export', label: 'Meal counts' },
  site: { permission: 'reports.export', label: 'Arrivals and departures' },
  catering: { permission: 'dietary.view_detail', label: 'Catering dietary totals' },
  'dietary-list': { permission: 'reports.export_sensitive', label: 'Named dietary list' },
};

reportRoutes.get('/exports', (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePermission(c, 'event.view', { eventId });
  return c.json({
    exports: Object.entries(EXPORTS)
      .filter(([, e]) => can(principal, e.permission, { eventId }))
      .map(([key, e]) => ({ key, label: e.label })),
  });
});

reportRoutes.get('/exports/:name{[a-z-]+\\.csv}', async (c) => {
  const eventId = c.req.param('eventId')!;
  const name = c.req.param('name').replace(/\.csv$/, '');
  const spec = EXPORTS[name];
  if (!spec) throw notFound();
  requirePermission(c, spec.permission, { eventId });
  const user = requireUser(c);
  const ev = await event(c, eventId);
  const tz = ev.timezone;
  const generated = nowIso();
  const preamble = [
    `${ev.name}: ${spec.label}`,
    `Generated ${localTime(generated, tz)} (${tz}). All times are ${tz}.`,
    'Scan records are operational records. They are not proof of where a person is and do not replace a roll call.',
  ];

  let csv: string;
  if (name === 'catering' || name === 'dietary-list') {
    const { results } = await c.env.DB.prepare(
      `SELECT d.category, d.item, d.severity, d.note, p.first_name, p.last_name, p.participant_id, r.group_name
         FROM dietary_entries d JOIN registrations r ON r.id = d.registration_id JOIN people p ON p.id = r.person_id
        WHERE d.event_id = ? AND r.status = 'active'`,
    )
      .bind(eventId)
      .all<Record<string, string>>();
    // Sorted here: items and names are encrypted in the database.
    sortByName(results).sort((a, b) => compareText(a.category, b.category) || compareText(a.item, b.item));
    if (name === 'catering') {
      const counts = new Map<string, { category: string; item: string; count: number; anaphylactic: number }>();
      for (const r of results) {
        const key = `${r.category}|${r.item!.toLowerCase()}`;
        const entry = counts.get(key) ?? { category: r.category!, item: r.item!, count: 0, anaphylactic: 0 };
        entry.count++;
        if (r.severity === 'anaphylactic') entry.anaphylactic++;
        counts.set(key, entry);
      }
      csv = toCsv(preamble, ['Type', 'Requirement', 'People', 'Of which anaphylactic'], [...counts.values()].map((e) => [e.category, e.item, e.count, e.anaphylactic]));
    } else {
      csv = toCsv(
        preamble,
        ['Name', 'Participant ID', 'Group', 'Type', 'Requirement', 'Severity', 'Note'],
        results.map((r) => [`${r.first_name} ${r.last_name}`, r.participant_id, r.group_name, r.category, r.item, r.severity, r.note]),
      );
    }
  } else {
    const model = await loadEventModel(c.env.DB, eventId, ev.feature_site === 1);
    const ctxName = new Map(model.contexts.map((x) => [x.key, x]));
    if (name === 'attendance') {
      const rows = [...model.scans]
        .sort((a, b) => a.deviceTime.localeCompare(b.deviceTime))
        .map((s) => {
          const person = s.registrationId ? model.people.get(s.registrationId) : null;
          const ctx = ctxName.get(s.contextKey);
          const evaluation = model.replays.get(s.contextKey)?.outcomes.get(s.id);
          return [
            localTime(s.deviceTime, tz),
            ctx?.type ?? s.contextKey.split(':')[0],
            ctx?.name ?? '',
            person ? `${person.firstName} ${person.lastName}` : 'Unknown card',
            person?.participantId ?? '',
            person?.groupName ?? '',
            s.direction,
            s.method,
            s.voided ? 'corrected (not counted)' : (evaluation?.outcome ?? s.storedOutcome),
            s.voided ? '' : (evaluation?.message ?? ''),
            s.correctionReason,
          ];
        });
      csv = toCsv(preamble, ['Time', 'Type', 'Where', 'Name', 'Participant ID', 'Group', 'Direction', 'How', 'Result', 'Message', 'Correction reason'], rows);
    } else if (name === 'activity-summary') {
      const s = summarise(model).contexts.filter((x) => x.type === 'activity');
      csv = toCsv(
        preamble,
        ['Activity', 'Status', 'Different people', 'Sign-ins counted', 'Repeat scans ignored', 'Capacity', 'Still signed in', 'Needs review'],
        s.map((x) => [x.name, x.status, x.people, x.acceptedScans, x.duplicates, x.capacity ?? '', x.trackSignOut ? x.presentNow : '', x.needsReview]),
      );
    } else if (name === 'meal-counts') {
      const s = summarise(model).contexts.filter((x) => x.type === 'meal');
      csv = toCsv(
        preamble,
        ['Meal', 'Status', 'Served (recorded)', 'On roster (expected)', 'Not recorded', 'Repeat scans ignored'],
        s.map((x) => [x.name, x.status, x.people, x.expected, (x.expected ?? 0) - x.people, x.duplicates]),
      );
    } else {
      const site = model.replays.get('site:');
      const rows: unknown[][] = [];
      for (const person of [...model.people.values()].sort((a, b) => a.lastName.localeCompare(b.lastName))) {
        const scans = model.scans
          .filter((s) => s.contextKey === 'site:' && s.registrationId === person.id && !s.voided && site?.outcomes.get(s.id)?.outcome === 'accepted')
          .sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));
        const arrivals = scans.filter((s) => s.direction === 'in').map((s) => localTime(s.deviceTime, tz));
        const departures = scans.filter((s) => s.direction === 'out').map((s) => localTime(s.deviceTime, tz));
        rows.push([
          `${person.firstName} ${person.lastName}`,
          person.participantId,
          person.kind,
          person.groupName,
          arrivals.join('; '),
          departures.join('; '),
          site?.states.get(person.id)?.present ? 'Yes' : 'No',
        ]);
      }
      csv = toCsv(preamble, ['Name', 'Participant ID', 'Youth or adult', 'Group', 'Arrived', 'Departed', 'Still recorded on site'], rows);
    }
  }

  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'export.download',
    eventId,
    targetType: 'export',
    targetId: name,
  }).run();
  const filename = `${ev.slug}-${name}.csv`;
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});
