import { describe, expect, it } from 'vitest';
import { devOutbox } from '../src/worker/services/email';
import { runMaintenance } from '../src/worker/services/maintenance';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const lastCode = (email: string) => /\b(\d{6})\b/.exec([...devOutbox].reverse().find((m) => m.to === email)!.text)![1]!;

describe('sign-up', () => {
  it('creates an account that can sign in with the emailed code, with no access to anything yet', async () => {
    const email = `new-${Date.now()}@example.test`;
    const res = await api('/auth/signup', { body: { email, displayName: 'New Leader' } });
    expect(res.status).toBe(200);
    expect([...devOutbox].reverse().find((m) => m.to === email)!.subject).toMatch(/^Welcome to CampCount/);

    const verify = await api('/auth/verify', { body: { email, code: lastCode(email) } });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get('Set-Cookie')!.split(';')[0]!;
    const me = await json(await api('/me', { cookie }));
    expect(me.user).toMatchObject({ displayName: 'New Leader', hasPassword: false });
    expect((await json(await api('/events', { cookie }))).events).toEqual([]);
    const row = await testEnv.DB.prepare(`SELECT email_verified_at FROM users WHERE email = ?`).bind(email).first<{ email_verified_at: string }>();
    expect(row!.email_verified_at).not.toBeNull();
  });

  it('answers the same for existing emails, sending a normal sign-in code and not changing the account', async () => {
    const user = await createUser({ name: 'Original Name' });
    const res = await api('/auth/signup', { body: { email: user.email, displayName: 'Someone Else' } });
    expect(await json(res)).toEqual({ ok: true });
    expect([...devOutbox].reverse().find((m) => m.to === user.email)!.subject).toMatch(/sign-in code/);
    expect((await json(await api('/me', { cookie: user.cookie }))).user.displayName).toBe('Original Name');
  });

  it('tidies away unconfirmed sign-ups after a week, but keeps people added to events', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const a = `stale-${Date.now()}@example.test`;
    const b = `invited-${Date.now()}@example.test`;
    await api('/auth/signup', { body: { email: a, displayName: 'Never Confirmed' } });
    const director = await createUser();
    await grant(director.id, 'event_manager', eventId);
    await api(`/events/${eventId}/staff`, { cookie: director.cookie, body: { email: b, displayName: 'Invited', roleKey: 'scanner' } });

    await runMaintenance(testEnv, new Date(Date.now() + 8 * 86400_000).toISOString());
    const left = await testEnv.DB.prepare(`SELECT email FROM users WHERE email IN (?, ?)`).bind(a, b).all<{ email: string }>();
    expect(left.results.map((r) => r.email)).toEqual([b]);
  });
});

describe('managing accounts', () => {
  it('admins can rename, make and remove admins', async () => {
    const admin = await createUser({ platformAdmin: true });
    const user = await createUser();
    expect((await api(`/admin/users/${user.id}`, { cookie: admin.cookie, method: 'PATCH', body: { displayName: 'Renamed', platformAdmin: true } })).status).toBe(200);
    let me = await json(await api('/me', { cookie: user.cookie }));
    expect(me.user.displayName).toBe('Renamed');
    expect(me.platformPermissions).toContain('platform.users.manage');
    await api(`/admin/users/${user.id}`, { cookie: admin.cookie, method: 'PATCH', body: { platformAdmin: false } });
    me = await json(await api('/me', { cookie: user.cookie }));
    expect(me.platformPermissions).toEqual([]);
    expect((await api(`/admin/users/${admin.id}`, { cookie: admin.cookie, method: 'PATCH', body: { platformAdmin: false } })).status).toBe(409);
  });

  it('deletes accounts with no history, and anonymises accounts that appear in records', async () => {
    const admin = await createUser({ platformAdmin: true });
    const fresh = await createUser();
    expect(await json(await api(`/admin/users/${fresh.id}`, { cookie: admin.cookie, method: 'DELETE' }))).toEqual({ result: 'deleted' });
    expect(await testEnv.DB.prepare(`SELECT 1 FROM users WHERE id = ?`).bind(fresh.id).first()).toBeNull();

    // An account that created an event must stay referenced, so it is anonymised.
    const creator = await createUser({ platformAdmin: true });
    await createEvent(creator.id);
    expect(await json(await api(`/admin/users/${creator.id}`, { cookie: admin.cookie, method: 'DELETE' }))).toEqual({ result: 'anonymised' });
    const row = await testEnv.DB.prepare(`SELECT email, display_name, status, password_hash FROM users WHERE id = ?`)
      .bind(creator.id)
      .first<Record<string, string | null>>();
    expect(row).toMatchObject({ display_name: 'Deleted account', status: 'disabled', password_hash: null });
    expect(row!.email).toMatch(/@deleted\.invalid$/);
    expect((await api('/me', { cookie: creator.cookie })).status).toBe(401);
  });

  it('never deletes the last admin or yourself from the admin screen', async () => {
    const admin = await createUser({ platformAdmin: true });
    expect((await api(`/admin/users/${admin.id}`, { cookie: admin.cookie, method: 'DELETE' })).status).toBe(409);
  });

  it('people can rename themselves and delete their own account with their password', async () => {
    const user = await createUser();
    await api('/auth/password', { cookie: user.cookie, body: { password: 'river-gums-at-dusk' } });
    expect((await api('/me', { cookie: user.cookie, method: 'PATCH', body: { displayName: 'Lincoln R' } })).status).toBe(200);
    expect((await json(await api('/me', { cookie: user.cookie }))).user.displayName).toBe('Lincoln R');
    expect((await api('/me', { cookie: user.cookie, method: 'DELETE', body: { password: 'wrong-password-1' } })).status).toBe(400);
    expect((await api('/me', { cookie: user.cookie, method: 'DELETE', body: { password: 'river-gums-at-dusk' } })).status).toBe(200);
    expect((await api('/me', { cookie: user.cookie })).status).toBe(401);
  });
});
