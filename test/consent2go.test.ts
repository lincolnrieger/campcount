import { describe, expect, it } from 'vitest';
import { c2gSection, isHealthExtra, prepareConsent2Go } from '../src/shared/consent2go';
import { api, createEvent, createRole, createUser, grant, json, testEnv } from './helpers';

// The Consent2Go template's columns (row 2), with a title in row 1. All people here are made up.
const HEADERS = [
  'Student ID', 'Student', 'LastName', 'FirstName', 'Gender', 'D.O.B', 'HomeRoom', 'House', 'Year', 'Responded P1', 'Responded P2', 'Attended',
  'Photo Use Authorised', 'ParacetamolOK', 'Anti-HistamineOK', 'Anti-InflammatoryOK', 'IbuprofenOK', 'Non-medical Dietary Requirements',
  'Dietary Requirement 1', 'Dietary Requirement 2', 'Amulance Cover', 'Private Health Cover', 'Swimming Ability', 'Swimming Comments',
  'Parent1 FullName', 'Parent1 Email', 'Emergency ContactName', 'Emergency ContactNumber', 'Other Support Details', 'Other Medications',
];
type Person = Partial<Record<(typeof HEADERS)[number], string>>;
const sheet = (name: string, people: Person[]) => ({
  name,
  rows: [['Consent2Go export: Summer Camp'], HEADERS, ...people.map((p) => HEADERS.map((h) => p[h] ?? ''))],
});

describe('reading a Consent2Go workbook', () => {
  it('reads every tab, finds the header row, and takes section from the tab', () => {
    const { prepared, tabs } = prepareConsent2Go([
      sheet('Joeys', [{ 'Student ID': '5000001', FirstName: 'Jo', LastName: 'Ey', 'Photo Use Authorised': 'Yes', 'Dietary Requirement 1': 'Peanut allergy', 'Dietary Requirement 2': 'Lactose', 'Swimming Ability': 'Weak', ParacetamolOK: 'Yes' }]),
      sheet('Scouts', [{ 'Student ID': '5000002', FirstName: 'Sc', LastName: 'Out', 'Photo Use Authorised': 'No' }]),
      sheet('Venturers', [{ 'Student ID': '5000003', FirstName: 'Ven', LastName: 'Turer' }]),
      sheet('Rovers and helpers', [{ 'Student ID': '5000004', FirstName: 'Ro', LastName: 'Ver' }]),
      sheet('1st Glenelg', [{ 'Student ID': '5000005', FirstName: 'Gl', LastName: 'Enelg', HomeRoom: 'Scouts' }]),
      { name: 'Notes', rows: [['Please return forms by Friday']] },
    ]);
    const by = (n: string) => prepared.find((p) => p.row.memberNumber === n)!;
    expect(by('5000001').row).toMatchObject({ section: 'Joeys', kind: 'youth', groupName: '', photoConsent: 'yes' });
    expect(by('5000001').dietaryText).toBe('Peanut allergy; Lactose');
    expect(by('5000001').row.extra).toMatchObject({ 'Swimming ability': 'Weak', 'Paracetamol OK': 'Yes' });
    expect(by('5000001').where).toBe('Joeys, row 3');
    expect(by('5000002').row).toMatchObject({ section: 'Scouts', photoConsent: 'no' });
    expect(by('5000003').row.section).toBe('Venturers');
    expect(by('5000004').row).toMatchObject({ section: 'Leaders', kind: 'adult' });
    // A tab named after a group: the group is the tab, the section comes from HomeRoom.
    expect(by('5000005').row).toMatchObject({ section: 'Scouts', groupName: '1st Glenelg' });
    // Parent and emergency contacts are never kept.
    expect(JSON.stringify(prepared)).not.toMatch(/Parent|Emergency/);
    expect(tabs.find((t) => t.name === 'Notes')!.skipped).toBeTruthy();
  });

  it('flags missing membership numbers and the same person on two tabs', () => {
    const { prepared } = prepareConsent2Go([
      sheet('Scouts', [{ 'Student ID': '', FirstName: 'No', LastName: 'Number' }, { 'Student ID': '6000001', FirstName: 'Twice', LastName: 'Listed' }]),
      sheet('Leaders', [{ 'Student ID': '6000001', FirstName: 'Twice', LastName: 'Listed' }]),
    ]);
    expect(prepared[0]!.errors[0]).toMatch(/Student ID/);
    expect(prepared[2]!.errors[0]).toMatch(/Same membership number/);
  });

  it('maps sections as asked: Joeys, Scouts, Venturers, everyone else a leader', () => {
    expect(['Joey Mob', 'Scout Troop', 'Venturer Unit', 'Cub Pack', 'Rovers', 'Event team'].map(c2gSection)).toEqual(['Joeys', 'Scouts', 'Venturers', 'Leaders', 'Leaders', 'Leaders']);
    expect(isHealthExtra('Ibuprofen OK')).toBe(true);
    expect(isHealthExtra('Swimming ability')).toBe(false);
  });
});

const myscoutRow = (memberNumber: string, firstName: string, o: Record<string, unknown> = {}) => ({
  memberNumber,
  firstName,
  preferredName: '',
  lastName: 'Registered',
  kind: 'youth',
  section: 'Cubs',
  groupName: 'Red Gum Cub Pack',
  position: '',
  roleLabel: '',
  team: '',
  sourceStatus: 'Approved',
  photoConsent: 'yes',
  dietaryFingerprint: null,
  ...o,
});

describe('importing Consent2Go after MyScout', () => {
  it('adds consent, dietary and details to registered people, adds new ones, and never withdraws anyone', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, feature_photo = 1 WHERE id = ?`).bind(eventId).run();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const base = 7100000 + Math.floor(Math.random() * 90000);
    const [a, b, c] = [String(base), String(base + 1), String(base + 2)];
    await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: [myscoutRow(a, 'Ava'), myscoutRow(c, 'Cy', { photoConsent: 'no' })] } });

    const fp = 'a'.repeat(64);
    const c2g = [
      // Ava: spelled differently and on a "Scouts" tab in Consent2Go; MyScout's details stay.
      myscoutRow(a, 'AVA', { lastName: 'REG', section: 'Scouts', groupName: '', sourceStatus: '', photoConsent: 'no', dietaryFingerprint: fp, extra: { 'Swimming ability': 'Strong', 'Ibuprofen OK': 'No', 'Other medications': '' } }),
      // Bo: not in MyScout yet.
      myscoutRow(b, 'Bo', { section: 'Venturers', groupName: 'Venturers', photoConsent: 'unknown', extra: { 'Swimming ability': 'Weak' } }),
      // Cy: no photo answer in Consent2Go; keeps MyScout's "no".
      myscoutRow(c, 'Cy', { photoConsent: 'unknown' }),
    ];
    const preview = await json(await api(`/events/${eventId}/import/preview`, { cookie: manager.cookie, body: { rows: c2g, withdrawMissing: true, source: 'consent2go' } }));
    expect(preview.plan.counts).toMatchObject({ create: 1, withdraw: 0 });
    const res = await api(`/events/${eventId}/import/commit`, { cookie: manager.cookie, body: { rows: c2g, withdrawMissing: true, source: 'consent2go' } });
    expect(res.status).toBe(200);

    const rows = await testEnv.DB.prepare(
      `SELECT p.member_number, p.first_name, p.last_name, r.section, r.group_name, r.photo_consent, r.status, r.extra_fields, r.dietary_review_pending
         FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? ORDER BY p.member_number`,
    )
      .bind(eventId)
      .all<Record<string, string | number>>();
    const by = (n: string) => rows.results.find((r) => r.member_number === n)!;
    expect(by(a)).toMatchObject({ first_name: 'Ava', last_name: 'Registered', section: 'Cubs', group_name: 'Red Gum Cub Pack', photo_consent: 'no', status: 'active', dietary_review_pending: 1 });
    expect(JSON.parse(String(by(a).extra_fields))).toEqual({ 'Swimming ability': 'Strong', 'Ibuprofen OK': 'No' });
    expect(by(b)).toMatchObject({ first_name: 'Bo', section: 'Venturers', status: 'active' });
    expect(by(c)).toMatchObject({ photo_consent: 'no', status: 'active' });

    // Medication permissions are only shown to people who can see dietary detail.
    const reg = await testEnv.DB.prepare(`SELECT r.id FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ?`).bind(eventId, a).first<{ id: string }>();
    const full = await json(await api(`/events/${eventId}/registrations/${reg!.id}`, { cookie: manager.cookie }));
    expect(full.registration.extra).toMatchObject({ 'Swimming ability': 'Strong', 'Ibuprofen OK': 'No' });
    await createRole('roster_only', ['event.view', 'roster.view']);
    const viewer = await createUser();
    await grant(viewer.id, 'roster_only', eventId);
    const limited = await json(await api(`/events/${eventId}/registrations/${reg!.id}`, { cookie: viewer.cookie }));
    expect(limited.registration.extra).toEqual({ 'Swimming ability': 'Strong' });
  });
});
