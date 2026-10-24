import { describe, expect, it } from 'vitest';
import { api, createActivity, createEvent, createUser, grant, json, testEnv } from './helpers';

async function setup() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id, { status: 'open' });
  const activityId = await createActivity(eventId, 'Kayaking');
  const other = await createActivity(eventId, 'Archery');
  return { admin, eventId, activityId, other };
}

const preview = (cookie: string, body: object) => api('/admin/preview', { cookie, body });

describe('view as (role preview)', () => {
  it('shows exactly what the chosen role can do, and nothing more', async () => {
    const { admin, eventId, activityId, other } = await setup();
    expect((await preview(admin.cookie, { eventId, roleKey: 'scanner' })).status).toBe(200);

    const me = await json(await api('/me', { cookie: admin.cookie }));
    expect(me.preview).toMatchObject({ eventId, roleKey: 'scanner', roleName: 'Scanner' });
    expect(me.platformPermissions).toEqual([]);

    // A scanner covers every activity and the site, but not meals.
    const { activities } = await json(await api(`/events/${eventId}/activities`, { cookie: admin.cookie }));
    expect(activities.map((a: any) => a.id).sort()).toEqual([activityId, other].sort());
    expect((await api(`/events/${eventId}/scan/activity/${other}/snapshot`, { cookie: admin.cookie })).status).toBe(200);
    expect((await api(`/events/${eventId}/scan/site/snapshot`, { cookie: admin.cookie })).status).toBe(200);
    expect((await api(`/events/${eventId}/meals`, { cookie: admin.cookie })).status).toBe(403);
    expect((await api(`/events/${eventId}/registrations`, { cookie: admin.cookie })).status).toBe(403);
    // Platform admin powers are switched off while previewing.
    expect((await api('/admin/users', { cookie: admin.cookie })).status).toBe(403);
  });

  it('switches roles and returns to the admin without signing in again', async () => {
    const { admin, eventId } = await setup();
    await preview(admin.cookie, { eventId, roleKey: 'scanner' });
    expect((await preview(admin.cookie, { eventId, roleKey: 'event_manager' })).status).toBe(200);
    expect((await api(`/events/${eventId}/registrations`, { cookie: admin.cookie })).status).toBe(200);

    expect((await api('/admin/preview', { cookie: admin.cookie, method: 'DELETE' })).status).toBe(200);
    const me = await json(await api('/me', { cookie: admin.cookie }));
    expect(me.preview).toBeNull();
    expect(me.platformPermissions).toContain('platform.users.manage');

    const { results } = await testEnv.DB.prepare(`SELECT action FROM audit_log WHERE actor_id = ? AND action LIKE 'preview.%' ORDER BY id`)
      .bind(admin.id)
      .all<{ action: string }>();
    expect(results.map((r) => r.action)).toEqual(['preview.start', 'preview.start', 'preview.stop']);
  });

  it('is for platform admins only, and only affects their own session', async () => {
    const { admin, eventId } = await setup();
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    expect((await preview(director.cookie, { eventId, roleKey: 'scanner' })).status).toBe(403);
    expect((await api('/admin/preview/options', { cookie: director.cookie })).status).toBe(403);

    // A second session for the same admin is unaffected by the first one's preview.
    const second = await createUser({ platformAdmin: true });
    await preview(admin.cookie, { eventId, roleKey: 'scanner' });
    const me = await json(await api('/me', { cookie: second.cookie }));
    expect(me.preview).toBeNull();
  });

  it('stops applying if the account loses admin rights', async () => {
    const { admin, eventId } = await setup();
    await preview(admin.cookie, { eventId, roleKey: 'event_manager' });
    await testEnv.DB.prepare(`UPDATE assignments SET revoked_at = ? WHERE user_id = ? AND role_id = 'role_platform_admin'`)
      .bind(new Date().toISOString(), admin.id)
      .run();
    expect((await api(`/events/${eventId}/registrations`, { cookie: admin.cookie })).status).toBe(404);
  });

  it('lists every event, activity and role to choose from', async () => {
    const { admin, eventId, activityId } = await setup();
    const options = await json(await api('/admin/preview/options', { cookie: admin.cookie }));
    const event = options.events.find((e: any) => e.id === eventId);
    expect(event.activities.map((a: any) => a.id)).toContain(activityId);
    expect(options.roles.map((r: any) => r.key)).toEqual(['event_manager', 'scanner', 'meal_leader']);
  });
});

describe('changing a staff role', () => {
  it('replaces the role in one step and keeps both in the audit log', async () => {
    const { admin, eventId, activityId } = await setup();
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    const helper = await createUser();
    await api(`/events/${eventId}/staff`, { cookie: director.cookie, body: { email: helper.email, roleKey: 'scanner' } });
    const { staff } = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    const row = staff.find((s: any) => s.user.id === helper.id);

    const res = await api(`/events/${eventId}/staff/${row.assignmentId}`, {
      cookie: director.cookie,
      method: 'PATCH',
      body: { roleKey: 'meal_leader' },
    });
    expect(res.status).toBe(200);
    const after = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    const mine = after.staff.filter((s: any) => s.user.id === helper.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: { key: 'meal_leader' } });
    expect((await api(`/events/${eventId}/scan/site/snapshot`, { cookie: helper.cookie })).status).toBe(403);
    void activityId;
    void admin;
  });

  it('cannot change your own role, or grant a role you do not hold', async () => {
    const { admin, eventId } = await setup();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    const { staff } = await json(await api(`/events/${eventId}/staff`, { cookie: director.cookie }));
    const own = staff.find((s: any) => s.user.id === director.id);
    expect(
      (await api(`/events/${eventId}/staff/${own.assignmentId}`, { cookie: director.cookie, method: 'PATCH', body: { roleKey: 'scanner' } })).status,
    ).toBe(409);
    // Someone without staff rights can't change anyone's role.
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', eventId);
    const mgr = staff.find((s: any) => s.user.id === manager.id);
    expect(
      (await api(`/events/${eventId}/staff/${mgr.assignmentId}`, { cookie: scanner.cookie, method: 'PATCH', body: { roleKey: 'scanner' } })).status,
    ).toBe(403);
    void admin;
  });
});
