import { describe, expect, it } from 'vitest';
import { api, createActivity, createEvent, createUser, grant, json, testEnv } from './helpers';

async function campWithRecords() {
  const admin = await createUser({ platformAdmin: true });
  const eventId = await createEvent(admin.id);
  const manager = await createUser();
  await grant(manager.id, 'event_manager', eventId);
  await createActivity(eventId);
  const now = new Date().toISOString();
  const personId = crypto.randomUUID();
  const regId = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare(`INSERT INTO people (id, member_number, first_name, last_name, created_at, updated_at) VALUES (?, ?, 'Sam', 'Lee', ?, ?)`).bind(
      personId,
      `T${personId.slice(0, 8)}`,
      now,
      now,
    ),
    testEnv.DB.prepare(
      `INSERT INTO registrations (id, event_id, person_id, kind, section, group_name, created_at, updated_at) VALUES (?, ?, ?, 'youth', 'Cubs', 'Test Pack', ?, ?)`,
    ).bind(regId, eventId, personId, now, now),
    testEnv.DB.prepare(
      `INSERT INTO scans (id, event_id, context_type, registration_id, direction, method, device_time, server_time, device_id, actor_user_id, outcome)
       VALUES (?, ?, 'site', ?, 'in', 'manual', ?, ?, 'test', ?, 'accepted')`,
    ).bind(crypto.randomUUID(), eventId, regId, now, now, manager.id),
  ]);
  return { admin, manager, eventId, personId };
}

describe('deleting a camp', () => {
  it('removes the camp and everything in it, but keeps staff accounts', async () => {
    const { admin, manager, eventId, personId } = await campWithRecords();
    const res = await api(`/admin/events/${eventId}`, { method: 'DELETE', cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, people: 1, scans: 1 });
    for (const table of ['events', 'activities', 'registrations', 'scans', 'assignments']) {
      const col = table === 'events' ? 'id' : 'event_id';
      expect(await testEnv.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} = ?`).bind(eventId).first()).toEqual({ n: 0 });
    }
    expect(await testEnv.DB.prepare(`SELECT 1 FROM people WHERE id = ?`).bind(personId).first()).toBeNull();
    expect(await testEnv.DB.prepare(`SELECT 1 FROM users WHERE id = ?`).bind(manager.id).first()).not.toBeNull();
    // The account that scanned there now has no history, so it can be deleted completely too.
    expect(await json(await api(`/admin/users/${manager.id}`, { cookie: admin.cookie, method: 'DELETE' }))).toEqual({ result: 'deleted' });
  });

  it('only platform admins can, and never from a camp address', async () => {
    const { admin, manager, eventId } = await campWithRecords();
    expect((await api(`/admin/events/${eventId}`, { method: 'DELETE', cookie: manager.cookie })).status).toBe(403);
    await testEnv.DB.prepare(`UPDATE events SET subdomain = ? WHERE id = ?`).bind(`del-${eventId.slice(0, 8)}`, eventId).run();
    expect((await api(`/admin/events/${eventId}`, { method: 'DELETE', cookie: admin.cookie, host: `del-${eventId.slice(0, 8)}.campcount.test` })).status).toBe(404);
    expect((await api(`/admin/events/${crypto.randomUUID()}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(404);
    expect((await api(`/admin/events/${eventId}`, { method: 'DELETE', cookie: admin.cookie })).status).toBe(200);
  });
});
