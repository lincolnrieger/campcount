import { describe, expect, it } from 'vitest';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

describe('demo mode', () => {
  it('creates an open demo camp with invented people, cards, activities, meals and demo accounts', async () => {
    const admin = await createUser({ platformAdmin: true });
    const res = await api('/admin/demo', { cookie: admin.cookie, body: { participants: 20 } });
    expect(res.status).toBe(201);
    const { eventId } = await json(res);

    const { event } = await json(await api(`/events/${eventId}`, { cookie: admin.cookie }));
    expect(event).toMatchObject({ status: 'open', isDemo: true });
    const { registrations } = await json(await api(`/events/${eventId}/registrations`, { cookie: admin.cookie }));
    expect(registrations.length).toBeGreaterThanOrEqual(24);
    expect(registrations.every((r: any) => r.memberNumber.startsWith('DEMO') && r.shortCode)).toBe(true);

    const demo = await json(await api('/admin/demo', { cookie: admin.cookie }));
    const accounts = demo.events.find((e: any) => e.id === eventId).accounts;
    expect(accounts.map((a: any) => a.role).sort()).toEqual(['Activity Leader', 'Camp Director', 'Event Manager', 'Gate Volunteer', 'Meal Leader']);
    const emails = await testEnv.DB.prepare(`SELECT email FROM users WHERE is_demo = 1`).all<{ email: string }>();
    expect(emails.results.every((u) => u.email.endsWith('@demo.invalid'))).toBe(true);
  });

  it('lets an admin switch into a demo account, and the switch is audited', async () => {
    const admin = await createUser({ platformAdmin: true });
    const { eventId } = await json(await api('/admin/demo', { cookie: admin.cookie, body: { participants: 10 } }));
    const demo = await json(await api('/admin/demo', { cookie: admin.cookie }));
    const leader = demo.events.find((e: any) => e.id === eventId).accounts.find((a: any) => a.role === 'Activity Leader');

    const res = await api(`/admin/demo/users/${leader.id}/switch`, { cookie: admin.cookie, method: 'POST' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!.split(';')[0]!;
    const me = await json(await api('/me', { cookie }));
    expect(me.user).toMatchObject({ displayName: 'Demo Activity leader', isDemo: true });
    // The admin's own session was ended.
    expect((await api('/me', { cookie: admin.cookie })).status).toBe(401);
    // The demo leader sees only their activity and no roster.
    expect((await api(`/events/${eventId}/registrations`, { cookie })).status).toBe(403);

    const audit = await testEnv.DB.prepare(`SELECT actor_id FROM audit_log WHERE action = 'demo.switch_user' AND target_id = ?`)
      .bind(leader.id)
      .first<{ actor_id: string }>();
    expect(audit!.actor_id).toBe(admin.id);
  });

  it('never switches into real accounts, and non-admins cannot use demo mode', async () => {
    const admin = await createUser({ platformAdmin: true });
    const real = await createUser();
    expect((await api(`/admin/demo/users/${real.id}/switch`, { cookie: admin.cookie, method: 'POST' })).status).toBe(404);
    const director = await createUser();
    await grant(director.id, 'camp_director', await createEvent(admin.id));
    expect((await api('/admin/demo', { cookie: director.cookie, body: { participants: 10 } })).status).toBe(403);
  });

  it('deletes a demo event with its invented people and demo accounts, and refuses real events', async () => {
    const admin = await createUser({ platformAdmin: true });
    const { eventId } = await json(await api('/admin/demo', { cookie: admin.cookie, body: { participants: 10 } }));
    // Some activity in the demo, including a correction.
    const { results } = await testEnv.DB.prepare(`SELECT id FROM activities WHERE event_id = ?`).bind(eventId).all<{ id: string }>();
    expect(results.length).toBeGreaterThan(0);

    const people = await testEnv.DB.prepare(`SELECT person_id FROM registrations WHERE event_id = ?`).bind(eventId).all<{ person_id: string }>();
    const users = await testEnv.DB.prepare(`SELECT user_id FROM assignments a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? AND u.is_demo = 1`)
      .bind(eventId)
      .all<{ user_id: string }>();
    const list = (ids: string[]) => ids.map((id) => `'${id}'`).join(',');

    expect((await api(`/admin/demo/${eventId}`, { cookie: admin.cookie, method: 'DELETE' })).status).toBe(200);
    for (const [table, where] of [
      ['events', `id = '${eventId}'`],
      ['people', `id IN (${list(people.results.map((p) => p.person_id))})`],
      ['users', `id IN (${list(users.results.map((u) => u.user_id))})`],
    ]) {
      const n = await testEnv.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>();
      expect(n!.n, table).toBe(0);
    }
    const realEvent = await createEvent(admin.id);
    expect((await api(`/admin/demo/${realEvent}`, { cookie: admin.cookie, method: 'DELETE' })).status).toBe(404);
  });
});
