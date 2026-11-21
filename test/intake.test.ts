import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const fp = (n: number) => n.toString(16).padStart(16, '0');
const ALL = { section: true, group: true, dietary: true };

const row = (memberNumber: string, over: Record<string, unknown> = {}) => ({
  memberNumber,
  firstName: 'Ava',
  preferredName: '',
  lastName: 'Example',
  kind: 'youth',
  section: 'Scouts',
  groupName: '1st Example',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: '',
  photoConsent: 'yes',
  dietaryFingerprint: null,
  ...over,
});

async function camp() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status: 'open' });
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1 WHERE id = ?`).bind(eventId).run();
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  const seen = (source: string, people: { memberNumber: string; name: string; fields: Record<string, string> }[]) =>
    api(`/events/${eventId}/intake/seen`, { cookie: manager.cookie, body: { source, people } });
  const boardOf = async () => (await json(await api(`/events/${eventId}/intake`, { cookie: manager.cookie }))).people as {
    memberNumber: string;
    state: string;
    changed: string[];
    myscout: unknown;
    consent2go: unknown;
    roster: { firstName: string; photoConsent: string; section: string; groupName: string; dietary?: unknown[] } | null;
  }[];
  const check = (body: Record<string, unknown>) => api(`/events/${eventId}/intake/check`, { cookie: manager.cookie, body });
  return { eventId, manager, seen, boardOf, check };
}

describe('import & check', () => {
  it('tracks each person across MyScout and Consent2Go, and skips them once checked', async () => {
    const c = await camp();
    expect((await c.seen('myscout', [{ memberNumber: '100', name: 'Ava Example', fields: { 'First name': fp(1), Dietary: fp(2) } }, { memberNumber: '200', name: 'Ben B', fields: { 'First name': fp(3) } }])).status).toBe(200);
    let board = await c.boardOf();
    expect(board.map((p) => [p.memberNumber, p.state, !!p.myscout, !!p.consent2go])).toEqual([
      ['100', 'new', true, false],
      ['200', 'new', true, false],
    ]);

    // Check Ava: she goes on the roster with what was chosen, and her dietary needs are recorded.
    const res = await c.check({ memberNumber: '100', checklist: ALL, row: row('100', { dietary: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic', note: '' }] }) });
    expect(res.status).toBe(200);
    expect((await json(res)).person).toMatchObject({ state: 'checked', roster: { firstName: 'Ava', dietary: [{ item: 'Peanut', severity: 'anaphylactic' }] } });

    // The same MyScout file again: Ava stays checked.
    await c.seen('myscout', [{ memberNumber: '100', name: 'Ava Example', fields: { 'First name': fp(1), Dietary: fp(2) } }]);
    expect((await c.boardOf()).find((p) => p.memberNumber === '100')!.state).toBe('checked');

    // Days later she fills in Consent2Go: she needs a look again.
    await c.seen('consent2go', [{ memberNumber: '100', name: 'Ava Example', fields: { 'Swimming Ability': fp(9) } }]);
    board = await c.boardOf();
    expect(board.find((p) => p.memberNumber === '100')).toMatchObject({ state: 'changed', changed: ['Now in Consent2Go'] });

    // Checked again; then her dietary note changes in MyScout.
    await c.check({ memberNumber: '100', checklist: ALL, row: row('100') });
    await c.seen('myscout', [{ memberNumber: '100', name: 'Ava Example', fields: { 'First name': fp(1), Dietary: fp(5) } }]);
    expect((await c.boardOf()).find((p) => p.memberNumber === '100')).toMatchObject({ state: 'changed', changed: ['MyScout: Dietary'] });
  });

  it('only puts people back on the list for section, group or dietary changes, and fills in the rest', async () => {
    const c = await camp();
    await c.seen('myscout', [{ memberNumber: '500', name: 'Eve E', fields: { formation: fp(1), medical_conditions: fp(2) } }]);
    await c.check({ memberNumber: '500', checklist: ALL, row: row('500', { photoConsent: 'unknown' }) });
    // Consent2Go arrives: back on the list.
    await c.seen('consent2go', [{ memberNumber: '500', name: 'Eve E', fields: { Year: fp(3), 'Swimming Ability': fp(4) } }]);
    expect((await c.boardOf()).find((p) => p.memberNumber === '500')).toMatchObject({ state: 'changed', changed: ['Now in Consent2Go'] });
    await c.check({ memberNumber: '500', checklist: ALL, row: row('500') });
    // Swimming changes: not a re-check. The class changes: a re-check.
    await c.seen('consent2go', [{ memberNumber: '500', name: 'Eve E', fields: { Year: fp(3), 'Swimming Ability': fp(5) } }]);
    expect((await c.boardOf()).find((p) => p.memberNumber === '500')!.state).toBe('checked');
    await c.seen('consent2go', [{ memberNumber: '500', name: 'Eve E', fields: { Year: fp(6), 'Swimming Ability': fp(5) } }]);
    expect((await c.boardOf()).find((p) => p.memberNumber === '500')).toMatchObject({ state: 'changed', changed: ['Consent2Go: Year'] });

    // Photo consent, names and Consent2Go answers fill in for people on the roster, leaving section and group alone.
    const res = await api(`/events/${c.eventId}/intake/sync`, {
      cookie: c.manager.cookie,
      body: { people: [{ memberNumber: '500', names: { firstName: 'Evelyn', preferredName: 'Eve', lastName: 'Example' }, photoConsent: 'no', extra: { 'Swimming ability': 'Strong' } }] },
    });
    expect(res.status).toBe(200);
    const p = (await c.boardOf()).find((x) => x.memberNumber === '500')!;
    expect(p.roster).toMatchObject({ firstName: 'Evelyn', photoConsent: 'no', section: 'Scouts', groupName: '1st Example' });
  });

  it('keeps half-done checks and people left off the camp apart', async () => {
    const c = await camp();
    await c.seen('consent2go', [{ memberNumber: '300', name: 'Cal C', fields: { a: fp(1) } }, { memberNumber: '400', name: 'Dee D', fields: { a: fp(2) } }]);
    await c.check({ memberNumber: '300', checklist: { details: true }, row: row('300') });
    await c.check({ memberNumber: '400', checklist: {}, leftOff: true });
    const board = await c.boardOf();
    expect(board.find((p) => p.memberNumber === '300')).toMatchObject({ state: 'in_progress' });
    expect(board.find((p) => p.memberNumber === '400')).toMatchObject({ state: 'left_off', roster: null });
    // Undo a check.
    await api(`/events/${c.eventId}/intake/check/300`, { cookie: c.manager.cookie, method: 'DELETE' });
    expect((await c.boardOf()).find((p) => p.memberNumber === '300')!.state).toBe('new');
  });

  it('only checks people in an uploaded file, and only for people who may import', async () => {
    const c = await camp();
    expect((await c.check({ memberNumber: '999', checklist: ALL, row: row('999') })).status).toBe(404);
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', c.eventId);
    expect((await api(`/events/${c.eventId}/intake`, { cookie: scanner.cookie })).status).toBe(403);
    // Values never go in: fingerprints only.
    expect((await c.seen('myscout', [{ memberNumber: '100', name: 'A', fields: { Dietary: 'peanut allergy' } }])).status).toBe(400);
  });
});
