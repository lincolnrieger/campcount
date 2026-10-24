import { describe, expect, it } from 'vitest';
import { devOutbox } from '../src/worker/services/email';
import { runMaintenance } from '../src/worker/services/maintenance';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

const PW = 'gum-trees-at-dusk';
const lastMail = (email: string) => [...devOutbox].reverse().find((m) => m.to === email)!;
const linkToken = (email: string) => /set-password#t=([\w-]+)/.exec(lastMail(email).text)![1]!;
const lastCode = (email: string) => /\b(\d{6})\b/.exec([...devOutbox].reverse().find((m) => m.to === email)!.text)![1]!;

describe('sign-up', () => {
  it('creates an account with a password, confirmed by the emailed code, with no access to anything yet', async () => {
    const email = `new-${Date.now()}@example.test`;
    const res = await api('/auth/signup', { body: { email, displayName: 'New Leader', password: PW } });
    expect(res.status).toBe(200);
    expect([...devOutbox].reverse().find((m) => m.to === email)!.subject).toMatch(/^Welcome to CampCount/);

    const verify = await api('/auth/verify', { body: { email, code: lastCode(email) } });
    expect(verify.status).toBe(200);
    const cookie = verify.headers.get('Set-Cookie')!.split(';')[0]!;
    const me = await json(await api('/me', { cookie }));
    expect(me.user).toMatchObject({ displayName: 'New Leader', hasPassword: true });
    expect((await json(await api('/events', { cookie }))).events).toEqual([]);
    const row = await testEnv.DB.prepare(`SELECT email_verified_at FROM users WHERE email = ?`).bind(email).first<{ email_verified_at: string }>();
    expect(row!.email_verified_at).not.toBeNull();
  });

  it('answers the same for existing emails, sending a normal sign-in code and not changing the account', async () => {
    const user = await createUser({ name: 'Original Name' });
    const res = await api('/auth/signup', { body: { email: user.email, displayName: 'Someone Else', password: PW } });
    expect(await json(res)).toEqual({ ok: true });
    expect([...devOutbox].reverse().find((m) => m.to === user.email)!.subject).toMatch(/sign-in code/);
    expect((await json(await api('/me', { cookie: user.cookie }))).user.displayName).toBe('Original Name');
  });

  it('rejects weak passwords before creating anything', async () => {
    const email = `weak-${Date.now()}@example.test`;
    const res = await api('/auth/signup', { body: { email, displayName: 'Weak', password: 'short' } });
    expect(res.status).toBe(400);
    expect(await testEnv.DB.prepare(`SELECT 1 FROM users WHERE email = ?`).bind(email).first()).toBeNull();
  });

  it('if they leave before entering the code, signing in with the password sends a fresh code instead', async () => {
    const email = `left-${Date.now()}@example.test`;
    await api('/auth/signup', { body: { email, displayName: 'Left Early', password: PW } });
    const first = lastCode(email);
    const res = await api('/auth/password/sign-in', { body: { email, password: PW } });
    expect(await json(res)).toEqual({ ok: true, verify: true });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const code = lastCode(email);
    expect(code).not.toBe(first);
    expect((await api('/auth/verify', { body: { email, code } })).status).toBe(200);
    // Confirmed now: the password signs straight in.
    const again = await api('/auth/password/sign-in', { body: { email, password: PW } });
    expect(again.headers.get('Set-Cookie')).toMatch(/__Host-cc_session/);
  });

  it('tidies away unconfirmed sign-ups after a week, but keeps people added to events', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const a = `stale-${Date.now()}@example.test`;
    const b = `invited-${Date.now()}@example.test`;
    await api('/auth/signup', { body: { email: a, displayName: 'Never Confirmed', password: PW } });
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

describe('password links', () => {
  it('admin-created accounts get an emailed set-up link that sets the password and signs them in', async () => {
    const admin = await createUser({ platformAdmin: true });
    const email = `made-${Date.now()}@example.test`;
    const res = await json(await api('/admin/users', { cookie: admin.cookie, body: { email, displayName: 'Made By Admin' } }));
    expect(res).toMatchObject({ emailed: true });
    expect(res.link).toMatch(/\/set-password#t=/);
    expect(lastMail(email).subject).toBe('Set up your CampCount account');
    const token = linkToken(email);
    expect(res.link.endsWith(token)).toBe(true);

    expect(await json(await api('/auth/link/check', { body: { token } }))).toEqual({ email, displayName: 'Made By Admin', purpose: 'setup' });
    expect((await api('/auth/link/use', { body: { token, password: 'short' } })).status).toBe(400);
    const used = await api('/auth/link/use', { body: { token, password: PW } });
    expect(used.status).toBe(200);
    const cookie = used.headers.get('Set-Cookie')!.split(';')[0]!;
    expect((await json(await api('/me', { cookie }))).user.hasPassword).toBe(true);
    // Works once.
    expect((await api('/auth/link/use', { body: { token, password: PW } })).status).toBe(400);
    expect((await api('/auth/password/sign-in', { body: { email, password: PW } })).headers.get('Set-Cookie')).toMatch(/__Host-cc_session/);
  });

  it('admins can make a reset link to copy or email; a new link retires the old one and using it signs out other devices', async () => {
    const admin = await createUser({ platformAdmin: true });
    const user = await createUser();
    await api('/auth/password', { cookie: user.cookie, body: { password: PW } });

    const copied = await json(await api(`/admin/users/${user.id}/password-link`, { cookie: admin.cookie, body: {} }));
    expect(copied).toMatchObject({ purpose: 'reset', emailed: false });
    const emailed = await json(await api(`/admin/users/${user.id}/password-link`, { cookie: admin.cookie, body: { sendEmail: true } }));
    expect(emailed.emailed).toBe(true);
    expect(lastMail(user.email).subject).toBe('Reset your CampCount password');

    const oldToken = copied.link.split('#t=')[1];
    expect((await api('/auth/link/check', { body: { token: oldToken } })).status).toBe(400);
    expect((await api('/auth/link/use', { body: { token: linkToken(user.email), password: 'a-brand-new-billy' } })).status).toBe(200);
    expect((await api('/me', { cookie: user.cookie })).status).toBe(401);

    const other = await createUser();
    expect((await api(`/admin/users/${user.id}/password-link`, { cookie: other.cookie, body: {} })).status).toBe(403);
  });

  it('event managers pick existing accounts, and new people are emailed an invite they can be re-sent', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id);
    const manager = await createUser({ name: 'Mandy Manager' });
    await grant(manager.id, 'event_manager', eventId);
    const existing = await createUser({ name: 'Eli Existing' });
    await api('/auth/password', { cookie: existing.cookie, body: { password: PW } });

    const people = (await json(await api(`/events/${eventId}/staff/people`, { cookie: manager.cookie }))).people;
    expect(people.map((p: { id: string }) => p.id)).toContain(existing.id);
    expect(people.map((p: { id: string }) => p.id)).not.toContain(manager.id); // already on the event

    const byId = await json(await api(`/events/${eventId}/staff`, { cookie: manager.cookie, body: { userId: existing.id, roleKey: 'scanner' } }));
    expect(byId).toMatchObject({ created: false });

    const email = `newbie-${Date.now()}@example.test`;
    const added = await json(await api(`/events/${eventId}/staff`, { cookie: manager.cookie, body: { email, displayName: 'Nell Newbie', roleKey: 'meal_leader' } }));
    expect(added).toMatchObject({ created: true, emailed: true });
    expect(lastMail(email).text).toMatch(/Mandy Manager has added you to .* as Meal team/);
    expect(added.link).toBeUndefined(); // managers never see the link

    const first = linkToken(email);
    expect((await api(`/events/${eventId}/staff/${added.assignmentId}/invite`, { cookie: manager.cookie, body: {} })).status).toBe(200);
    expect(linkToken(email)).not.toBe(first);
    expect((await api(`/events/${eventId}/staff/${byId.assignmentId}/invite`, { cookie: manager.cookie, body: {} })).status).toBe(409);
  });
});
