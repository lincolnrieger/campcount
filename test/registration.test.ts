import { describe, expect, it } from 'vitest';
import { devOutbox } from '../src/worker/services/email';
import { runMaintenance } from '../src/worker/services/maintenance';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const lastCode = (email: string) => /\b(\d{6})\b/.exec([...devOutbox].reverse().find((m) => m.to === email)!.text)![1]!;

const kid = (o: Record<string, unknown> = {}) => ({
  firstName: 'Ruby',
  lastName: 'Rowe',
  memberNumber: '555123',
  kind: 'youth',
  section: 'Cubs',
  groupName: 'Red Gum Cub Pack',
  photoConsent: 'yes',
  dietary: [{ category: 'allergy', item: 'Peanut', severity: 'anaphylactic' }],
  ...o,
});

async function setup(settings: Record<string, unknown> = { open: true }) {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  await testEnv.DB.prepare(`UPDATE events SET feature_dietary = 1, starts_on = '2099-12-04', ends_on = '2099-12-06' WHERE id = ?`).bind(eventId).run();
  const manager = await createUser({ name: 'Mandy Manager' });
  await grant(manager.id, 'event_manager', eventId);
  await api(`/events/${eventId}/registration`, { cookie: manager.cookie, method: 'PATCH', body: settings });
  const reg = await json(await api(`/events/${eventId}/registration`, { cookie: manager.cookie }));
  const code = reg.link ? reg.link.split('/register/')[1] : null;
  return { eventId, manager, code };
}

describe('registration page', () => {
  it('takes a registration, confirms the email, and waits for approval before joining the roster', async () => {
    const s = await setup();
    const page = await json(await api(`/public/register/${s.code}`));
    expect(page).toMatchObject({ open: true, asksDietary: true, approval: 'manual', event: { startsOn: '2099-12-04' } });

    const email = `parent-${Date.now()}@example.test`;
    const sent = await json(await api(`/public/register/${s.code}`, { body: { ...kid(), email } }));
    expect(sent.status).toBe('confirm');
    expect((await api(`/public/register/${s.code}/confirm`, { body: { requestId: sent.requestId, code: '000000' } })).status).toBe(400);
    const confirmed = await json(await api(`/public/register/${s.code}/confirm`, { body: { requestId: sent.requestId, code: lastCode(email) } }));
    expect(confirmed).toMatchObject({ status: 'pending' });

    // A sibling from the same browser skips the code.
    const sibling = await json(
      await api(`/public/register/${s.code}`, { body: { ...kid({ firstName: 'Max', memberNumber: null }), email, contactToken: confirmed.contactToken } }),
    );
    expect(sibling.status).toBe('pending');

    let roster = await json(await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie }));
    expect(roster.registrations).toHaveLength(0);
    const manage = await json(await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie }));
    expect(manage.counts).toEqual({ registered: 0, waiting: 2 });
    const ruby = manage.requests.find((r: { firstName: string }) => r.firstName === 'Ruby');
    expect(ruby).toMatchObject({ status: 'pending', contactEmail: email, dietary: [{ item: 'Peanut', severity: 'anaphylactic' }] });
    const max = manage.requests.find((r: { firstName: string }) => r.firstName === 'Max');
    expect(max.guest).toBe(true);

    await api(`/events/${s.eventId}/registration/requests/${ruby.id}/approve`, { cookie: s.manager.cookie, body: {} });
    await api(`/events/${s.eventId}/registration/requests/${max.id}/decline`, { cookie: s.manager.cookie, body: {} });
    roster = await json(await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie }));
    expect(roster.registrations).toHaveLength(1);
    expect(roster.registrations[0]).toMatchObject({ firstName: 'Ruby', section: 'Cubs', dietary: [{ item: 'Peanut' }] });
    expect(roster.registrations[0].shortCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect([...devOutbox].reverse().find((m) => m.to === email)!.subject).toMatch(/^Ruby Rowe is registered/);
  });

  it('approves automatically when the event allows it, and respects limits and closing dates', async () => {
    const s = await setup({ open: true, autoApprove: true, limit: 1 });
    const email = `auto-${Date.now()}@example.test`;
    const sent = await json(await api(`/public/register/${s.code}`, { body: { ...kid(), email } }));
    const done = await json(await api(`/public/register/${s.code}/confirm`, { body: { requestId: sent.requestId, code: lastCode(email) } }));
    expect(done.status).toBe('approved');
    expect((await json(await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie }))).registrations).toHaveLength(1);

    const full = await json(await api(`/public/register/${s.code}`));
    expect(full).toMatchObject({ open: false, closedMessage: 'This event is full.' });
    expect((await api(`/public/register/${s.code}`, { body: { ...kid({ memberNumber: '9' }), email } })).status).toBe(409);

    await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie, method: 'PATCH', body: { limit: null, closesOn: '2000-01-01' } });
    expect((await json(await api(`/public/register/${s.code}`))).closedMessage).toBe('Registration for this event has closed.');
  });

  it('never renames an existing member and keeps their printed card', async () => {
    const s = await setup();
    const added = await json(await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie, body: kid({ memberNumber: '777', firstName: 'Real' }) }));
    const before = (await json(await api(`/events/${s.eventId}/registrations/${added.registrationId}`, { cookie: s.manager.cookie }))).registration.shortCode;

    const email = `stranger-${Date.now()}@example.test`;
    const sent = await json(await api(`/public/register/${s.code}`, { body: { ...kid({ memberNumber: '777', firstName: 'Fake' }), email } }));
    await api(`/public/register/${s.code}/confirm`, { body: { requestId: sent.requestId, code: lastCode(email) } });
    const req = (await json(await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie }))).requests[0];
    expect(req).toMatchObject({ alreadyRegistered: true, memberOnFile: 'Real Rowe' });

    await api(`/events/${s.eventId}/registration/requests/${req.id}/approve`, { cookie: s.manager.cookie, body: {} });
    const after = (await json(await api(`/events/${s.eventId}/registrations/${added.registrationId}`, { cookie: s.manager.cookie }))).registration;
    expect(after.firstName).toBe('Real');
    expect(after.shortCode).toBe(before);
  });

  it('is closed until opened, only managers see requests, and old link stops working when replaced', async () => {
    const s = await setup({ autoApprove: false });
    expect(s.code).toBeNull();
    await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie, method: 'PATCH', body: { open: true } });
    const first = (await json(await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie }))).link.split('/register/')[1];
    await api(`/events/${s.eventId}/registration`, { cookie: s.manager.cookie, method: 'PATCH', body: { newLink: true } });
    expect((await api(`/public/register/${first}`)).status).toBe(404);

    const scanner = await createUser();
    await grant(scanner.id, 'scanner', s.eventId);
    expect((await api(`/events/${s.eventId}/registration`, { cookie: scanner.cookie })).status).toBe(403);
    expect((await api(`/events/${s.eventId}/registrations`, { cookie: scanner.cookie, body: kid() })).status).toBe(403);
  });

  it('forgets unconfirmed requests after a day', async () => {
    const s = await setup();
    const email = `gone-${Date.now()}@example.test`;
    const sent = await json(await api(`/public/register/${s.code}`, { body: { ...kid(), email } }));
    await runMaintenance(testEnv, new Date(Date.now() + 2 * 86400_000).toISOString());
    expect(await testEnv.DB.prepare(`SELECT 1 FROM registration_requests WHERE id = ?`).bind(sent.requestId).first()).toBeNull();
  });
});

describe('adding someone by hand', () => {
  it('puts them on the roster with a card, and refuses a duplicate membership number', async () => {
    const s = await setup();
    const res = await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie, body: kid({ memberNumber: null, kind: 'adult', section: 'Leaders', position: 'Cook' }) });
    expect(res.status).toBe(201);
    const { registrationId } = await json(res);
    const person = (await json(await api(`/events/${s.eventId}/registrations/${registrationId}`, { cookie: s.manager.cookie }))).registration;
    expect(person).toMatchObject({ kind: 'adult', position: 'Cook' });
    expect(person.memberNumber).toMatch(/^GUEST-/);
    expect(person.shortCode).not.toBeNull();
    expect((await api(`/events/${s.eventId}/registrations`, { cookie: s.manager.cookie, body: kid({ memberNumber: person.memberNumber }) })).status).toBe(409);
  });
});
