import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/worker/services/credentials';
import { runMaintenance } from '../src/worker/services/maintenance';
import { csvCell } from '../src/worker/services/reports';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const person = (memberNumber: string, o: Record<string, unknown> = {}) => ({
  memberNumber,
  firstName: `Kid${memberNumber}`,
  preferredName: '',
  lastName: 'Example',
  kind: 'youth',
  section: 'Cubs',
  groupName: 'Example Pack',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
  ...o,
});

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, feature_meals = 1, feature_site = 1 WHERE id = ?`).bind(eventId).run();
  const director = await createUser();
  await grant(director.id, 'event_manager', eventId);
  await api(`/events/${eventId}/import/commit`, {
    cookie: director.cookie,
    body: {
      rows: [
        person('1', { dietaryFingerprint: 'b'.repeat(64), dietary: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }] }),
        person('2', { firstName: '=HYPERLINK("http://evil")' }),
        person('3'),
      ],
    },
  });
  await api(`/events/${eventId}/credentials/issue`, { cookie: director.cookie, body: { mode: 'missing' } });
  const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: director.cookie, body: {} }));
  const kayak = await json(await api(`/events/${eventId}/activities`, { cookie: director.cookie, body: { name: 'Kayak', trackSignOut: true } }));
  const lunch = await json(await api(`/events/${eventId}/meals`, { cookie: director.cookie, body: { name: 'Lunch' } }));
  await api(`/events/${eventId}/transition`, { cookie: director.cookie, body: { to: 'open' } });
  const tokens: string[] = cards.map((c: any) => c.qr.split('#')[1]);
  return { admin, eventId, director, kayak: kayak.id as string, lunch: lunch.id as string, tokens };
}

let t = 0;
async function scans(eventId: string, cookie: string, items: { type: string; id: string | null; token: string; direction?: string }[]) {
  return json(
    await api(`/events/${eventId}/scans`, {
      cookie,
      body: {
        deviceId: 'report-device',
        scans: await Promise.all(
          items.map(async (i) => ({
            id: crypto.randomUUID(),
            contextType: i.type,
            contextId: i.id,
            direction: i.direction ?? 'in',
            deviceTime: new Date(Date.now() - 600_000 + t++ * 1000).toISOString(),
            method: 'qr',
            credentialHash: await hashToken(i.token),
          })),
        ),
      },
    }),
  );
}

describe('live dashboard', () => {
  it('counts from scan records without double counting repeats', async () => {
    const c = await camp();
    await scans(c.eventId, c.director.cookie, [
      { type: 'meal', id: c.lunch, token: c.tokens[0]! },
      { type: 'meal', id: c.lunch, token: c.tokens[0]! },
      { type: 'meal', id: c.lunch, token: c.tokens[1]! },
      { type: 'activity', id: c.kayak, token: c.tokens[0]! },
      { type: 'activity', id: c.kayak, token: c.tokens[1]! },
      { type: 'activity', id: c.kayak, token: c.tokens[1]!, direction: 'out' },
    ]);
    const live = await json(await api(`/events/${c.eventId}/live`, { cookie: c.director.cookie }));
    const lunch = live.contexts.find((x: any) => x.key === `meal:${c.lunch}`);
    expect(lunch).toMatchObject({ people: 2, expected: 3, duplicates: 1 });
    const kayak = live.contexts.find((x: any) => x.key === `activity:${c.kayak}`);
    expect(kayak).toMatchObject({ people: 2, presentNow: 1 });
    expect(live.roster).toMatchObject({ active: 3, youth: 3 });
  });

  it('is not available to volunteers', async () => {
    const c = await camp();
    const leader = await createUser();
    await grant(leader.id, 'scanner', c.eventId, c.kayak);
    expect((await api(`/events/${c.eventId}/live`, { cookie: leader.cookie })).status).toBe(403);
  });
});

describe('reconciliation and close-out', () => {
  it('lists people still signed in and lets a director sign them out with a reason', async () => {
    const c = await camp();
    await scans(c.eventId, c.director.cookie, [
      { type: 'activity', id: c.kayak, token: c.tokens[0]! },
      { type: 'site', id: null, token: c.tokens[2]! },
      { type: 'site', id: null, token: c.tokens[1]!, direction: 'out' },
    ]);
    const rec = await json(await api(`/events/${c.eventId}/reconciliation`, { cookie: c.director.cookie }));
    expect(rec.items.map((i: any) => i.kind).sort()).toEqual(['review', 'still_present', 'still_present']);

    const res = await json(
      await api(`/events/${c.eventId}/reconciliation/sign-out-all`, {
        cookie: c.director.cookie,
        body: { contextKey: `activity:${c.kayak}`, reason: 'Activity finished, all returned to camp' },
      }),
    );
    expect(res.signedOut).toBe(1);
    const after = await json(await api(`/events/${c.eventId}/reconciliation`, { cookie: c.director.cookie }));
    expect(after.items.filter((i: any) => i.contextKey === `activity:${c.kayak}`)).toEqual([]);
  });

  it('will not archive with open items unless explicitly acknowledged, and records that', async () => {
    const c = await camp();
    await scans(c.eventId, c.director.cookie, [{ type: 'site', id: null, token: c.tokens[0]! }]);
    await api(`/events/${c.eventId}/transition`, { cookie: c.director.cookie, body: { to: 'completed' } });
    const blocked = await api(`/events/${c.eventId}/transition`, { cookie: c.admin.cookie, body: { to: 'archived' } });
    expect(blocked.status).toBe(409);
    expect((await json(blocked)).error.message).toMatch(/1 attendance records/);
    const ok = await api(`/events/${c.eventId}/transition`, { cookie: c.admin.cookie, body: { to: 'archived', acknowledgeOpenItems: true } });
    expect(ok.status).toBe(200);
    const audit = await testEnv.DB.prepare(`SELECT detail FROM audit_log WHERE event_id = ? AND action = 'event.transition' ORDER BY id DESC LIMIT 1`)
      .bind(c.eventId)
      .first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({ to: 'archived', openItemsAcknowledged: 1 });
  });
});

describe('exports', () => {
  it('applies permissions per export and audits downloads', async () => {
    const c = await camp();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', c.eventId);
    const meal = await createUser();
    await grant(meal.id, 'meal_leader', c.eventId);
    const leader = await createUser();
    await grant(leader.id, 'scanner', c.eventId);

    expect((await api(`/events/${c.eventId}/exports/attendance.csv`, { cookie: manager.cookie })).status).toBe(200);
    expect((await api(`/events/${c.eventId}/exports/dietary-list.csv`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/exports/dietary-list.csv`, { cookie: meal.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/exports/catering.csv`, { cookie: meal.cookie })).status).toBe(200);
    expect((await api(`/events/${c.eventId}/exports/attendance.csv`, { cookie: meal.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/exports/attendance.csv`, { cookie: leader.cookie })).status).toBe(403);
    expect((await api(`/events/${c.eventId}/exports/dietary-list.csv`, { cookie: manager.cookie })).status).toBe(200);

    const listed = await json(await api(`/events/${c.eventId}/exports`, { cookie: meal.cookie }));
    expect(listed.exports.map((e: any) => e.key)).toEqual(['catering']);
    const audit = await testEnv.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE event_id = ? AND action = 'export.download'`)
      .bind(c.eventId)
      .first<{ n: number }>();
    expect(audit!.n).toBe(3);
  });

  it('scanners are kept out of the live dashboard and close-out', async () => {
    const c = await camp();
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/reconciliation`, { cookie: scanner.cookie })).status).toBe(403);
  });

  it('catering totals carry no names; CSVs state the time zone and neutralise formulas', async () => {
    const c = await camp();
    await scans(c.eventId, c.director.cookie, c.tokens.map((token) => ({ type: 'meal', id: c.lunch, token })));
    const catering = await (await api(`/events/${c.eventId}/exports/catering.csv`, { cookie: c.director.cookie })).text();
    expect(catering).toContain('"allergy","Peanut","1","1"');
    expect(catering).not.toContain('Kid1');

    const attendance = await (await api(`/events/${c.eventId}/exports/attendance.csv`, { cookie: c.director.cookie })).text();
    expect(attendance).toContain('All times are Australia/Adelaide');
    expect(attendance).not.toMatch(/"=HYPERLINK/);
    expect(attendance).toContain(`"'=HYPERLINK`);
  });

  it('csvCell escapes quotes and formula prefixes', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    for (const bad of ['=1+1', '+1', '-1', '@x']) expect(csvCell(bad).startsWith(`"'`)).toBe(true);
  });
});

describe('retention', () => {
  it('purges sensitive data after 90 days and named records after 2 years, keeping totals', async () => {
    const c = await camp();
    await scans(c.eventId, c.director.cookie, [{ type: 'meal', id: c.lunch, token: c.tokens[0]! }]);
    await api(`/events/${c.eventId}/transition`, { cookie: c.director.cookie, body: { to: 'completed' } });
    const closed = await testEnv.DB.prepare(`SELECT closed_at FROM events WHERE id = ?`).bind(c.eventId).first<{ closed_at: string }>();
    const at = (days: number) => new Date(Date.parse(closed!.closed_at) + days * 86400_000).toISOString();

    await runMaintenance(testEnv, at(89));
    expect((await testEnv.DB.prepare(`SELECT count(*) AS n FROM dietary_entries WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>())!.n).toBe(1);

    await runMaintenance(testEnv, at(91));
    expect((await testEnv.DB.prepare(`SELECT count(*) AS n FROM dietary_entries WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>())!.n).toBe(0);
    const creds = await testEnv.DB.prepare(`SELECT DISTINCT status, token_ciphertext FROM credentials WHERE event_id = ?`).bind(c.eventId).all();
    expect(creds.results).toEqual([{ status: 'revoked', token_ciphertext: '' }]);
    const consent = await testEnv.DB.prepare(`SELECT DISTINCT photo_consent FROM registrations WHERE event_id = ?`).bind(c.eventId).all();
    expect(consent.results).toEqual([{ photo_consent: 'unknown' }]);

    await runMaintenance(testEnv, at(731));
    const event = await testEnv.DB.prepare(`SELECT records_purged_at, archive_summary FROM events WHERE id = ?`).bind(c.eventId).first<{ records_purged_at: string; archive_summary: string }>();
    expect(event!.records_purged_at).not.toBeNull();
    const summary = JSON.parse(event!.archive_summary);
    expect(summary.contexts.find((x: any) => x.type === 'meal').people).toBe(1);
    for (const table of ['scans', 'registrations', 'credentials']) {
      const n = await testEnv.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE event_id = ?`).bind(c.eventId).first<{ n: number }>();
      expect(n!.n, table).toBe(0);
    }
    const actions = await testEnv.DB.prepare(`SELECT action FROM audit_log WHERE event_id = ? AND actor_type = 'system'`).bind(c.eventId).all<{ action: string }>();
    expect(actions.results.map((a) => a.action)).toEqual(['retention.purge_sensitive', 'retention.purge_records']);
  });
});
