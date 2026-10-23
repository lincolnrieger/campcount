import { describe, expect, it } from 'vitest';
import { api, createActivity, createEvent, createUser, grant, json, testEnv } from './helpers';

async function setup() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  const director = await createUser();
  await grant(director.id, 'camp_director', eventId);
  return { admin, eventId, director };
}

describe('staff assignments', () => {
  it('directors can add staff, creating accounts as needed; roles apply immediately', async () => {
    const { eventId, director } = await setup();
    const res = await api(`/events/${eventId}/staff`, {
      cookie: director.cookie,
      body: { email: 'new.leader@example.test', displayName: 'New Leader', roleKey: 'gate_volunteer' },
    });
    expect(res.status).toBe(201);
    const { staff } = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    expect(staff.map((s: any) => s.user.email)).toContain('new.leader@example.test');
  });

  it('limits activity roles to an activity in the same event', async () => {
    const { admin, eventId, director } = await setup();
    const activityId = await createActivity(eventId);
    const foreignActivity = await createActivity(await createEvent(admin.id));
    const leader = await createUser();

    const ok = await api(`/events/${eventId}/staff`, {
      cookie: director.cookie,
      body: { email: leader.email, roleKey: 'activity_leader', activityId },
    });
    expect(ok.status).toBe(201);
    const bad = await api(`/events/${eventId}/staff`, {
      cookie: director.cookie,
      body: { email: leader.email, roleKey: 'activity_leader', activityId: foreignActivity },
    });
    expect(bad.status).toBe(400);
  });

  it('prevents privilege escalation', async () => {
    const { eventId } = await setup();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    // Event managers lack staff.manage altogether.
    const res = await api(`/events/${eventId}/staff`, {
      cookie: manager.cookie,
      body: { email: manager.email, roleKey: 'camp_director' },
    });
    expect(res.status).toBe(403);
  });

  it('does not allow granting platform roles through event staff', async () => {
    const { eventId, director } = await setup();
    const res = await api(`/events/${eventId}/staff`, {
      cookie: director.cookie,
      body: { email: director.email, roleKey: 'platform_admin' },
    });
    expect(res.status).toBe(400);
  });

  it('revocation takes effect on the very next request and is audited', async () => {
    const { eventId, director } = await setup();
    const gate = await createUser();
    await api(`/events/${eventId}/staff`, { cookie: director.cookie, body: { email: gate.email, roleKey: 'gate_volunteer' } });
    expect((await api(`/events/${eventId}`, { cookie: gate.cookie })).status).toBe(200);

    const { staff } = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    const assignment = staff.find((s: any) => s.user.email === gate.email);
    const del = await api(`/events/${eventId}/staff/${assignment.assignmentId}`, { cookie: director.cookie, method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await api(`/events/${eventId}`, { cookie: gate.cookie })).status).toBe(404);

    const { results } = await testEnv.DB.prepare(`SELECT action FROM audit_log WHERE event_id = ? ORDER BY id`)
      .bind(eventId)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(['assignment.grant', 'assignment.revoke']);
  });

  it('directors cannot remove themselves', async () => {
    const { eventId, director } = await setup();
    const { staff } = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    const mine = staff.find((s: any) => s.user.id === director.id);
    const res = await api(`/events/${eventId}/staff/${mine.assignmentId}`, { cookie: director.cookie, method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  it('cannot manage staff of another event', async () => {
    const { admin, director } = await setup();
    const other = await createEvent(admin.id);
    expect((await api(`/events/${other}/staff`, { cookie: director.cookie })).status).toBe(404);
    const res = await api(`/events/${other}/staff`, {
      cookie: director.cookie,
      body: { email: director.email, roleKey: 'camp_director' },
    });
    expect(res.status).toBe(404);
  });
});

describe('platform administration', () => {
  it('only admins manage users; disabling ends sessions immediately', async () => {
    const admin = await createUser({ platformAdmin: true });
    const target = await createUser();
    expect((await api('/admin/users', { cookie: target.cookie })).status).toBe(403);

    expect((await api('/me', { cookie: target.cookie })).status).toBe(200);
    const res = await api(`/admin/users/${target.id}/status`, { cookie: admin.cookie, body: { status: 'disabled' } });
    expect(res.status).toBe(200);
    expect((await api('/me', { cookie: target.cookie })).status).toBe(401);
  });

  it('audit log cannot be altered', async () => {
    await testEnv.DB.prepare(`INSERT INTO audit_log (at, actor_type, action) VALUES (?, 'system', 'test')`)
      .bind(new Date().toISOString())
      .run();
    await expect(testEnv.DB.prepare(`UPDATE audit_log SET action = 'tampered'`).run()).rejects.toThrow(/append-only/);
    await expect(testEnv.DB.prepare(`DELETE FROM audit_log`).run()).rejects.toThrow(/retained/);
  });
});
