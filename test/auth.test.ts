import { describe, expect, it } from 'vitest';
import { devOutbox } from '../src/worker/services/email';
import { api, createUser, json, testEnv } from './helpers';

function lastEmailTo(email: string) {
  const message = [...devOutbox].reverse().find((m) => m.to === email);
  if (!message) throw new Error('no email');
  return {
    code: /code is (\d{6})/.exec(message.text)![1]!,
    token: /#t=([A-Za-z0-9_-]+)/.exec(message.text)![1]!,
  };
}

describe('sign-in', () => {
  it('responds identically for unknown emails and sends nothing', async () => {
    const before = devOutbox.length;
    const res = await api('/auth/request', { body: { email: 'nobody@example.test' } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect(devOutbox.length).toBe(before);
  });

  it('signs in with a code, sets a hardened cookie, and the code is single-use', async () => {
    const user = await createUser();
    await api('/auth/request', { body: { email: user.email.toUpperCase() } });
    const { code } = lastEmailTo(user.email);

    const res = await api('/auth/verify', { body: { email: user.email, code } });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/^__Host-cc_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const me = await api('/me', { cookie: cookie.split(';')[0] });
    expect((await json(me)).user.email).toBe(user.email);

    const replay = await api('/auth/verify', { body: { email: user.email, code } });
    expect(replay.status).toBe(400);
  });

  it('signs in with the emailed link token exactly once', async () => {
    const user = await createUser();
    await api('/auth/request', { body: { email: user.email } });
    const { token } = lastEmailTo(user.email);
    expect((await api('/auth/verify', { body: { token } })).status).toBe(200);
    expect((await api('/auth/verify', { body: { token } })).status).toBe(400);
  });

  it('locks a code after five wrong attempts', async () => {
    const user = await createUser();
    await api('/auth/request', { body: { email: user.email } });
    const { code } = lastEmailTo(user.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await api('/auth/verify', { body: { email: user.email, code: wrong } })).status).toBe(400);
    }
    expect((await api('/auth/verify', { body: { email: user.email, code } })).status).toBe(400);
  });

  it('a newer code invalidates the older one', async () => {
    const user = await createUser();
    await api('/auth/request', { body: { email: user.email } });
    const first = lastEmailTo(user.email);
    await api('/auth/request', { body: { email: user.email } });
    expect((await api('/auth/verify', { body: { email: user.email, code: first.code } })).status).toBe(400);
  });

  it('does not sign in disabled users', async () => {
    const user = await createUser();
    await testEnv.DB.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).bind(user.id).run();
    expect((await api('/me', { cookie: user.cookie })).status).toBe(401);
    const before = devOutbox.length;
    await api('/auth/request', { body: { email: user.email } });
    expect(devOutbox.length).toBe(before);
  });

  it('sign-out revokes the session', async () => {
    const user = await createUser();
    expect((await api('/me', { cookie: user.cookie })).status).toBe(200);
    await api('/auth/sign-out', { method: 'POST', cookie: user.cookie });
    expect((await api('/me', { cookie: user.cookie })).status).toBe(401);
  });

  it('expires sessions after the idle timeout', async () => {
    const user = await createUser();
    await testEnv.DB.prepare(`UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?`)
      .bind(user.id)
      .run();
    expect((await api('/me', { cookie: user.cookie })).status).toBe(401);
  });
});

describe('request hardening', () => {
  it('rejects writes from another origin', async () => {
    const admin = await createUser({ platformAdmin: true });
    const res = await api('/events', {
      cookie: admin.cookie,
      origin: 'https://evil.example',
      body: { name: 'X', startsOn: '2026-12-01', endsOn: '2026-12-02' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects writes without an Origin header', async () => {
    const res = await api('/auth/request', { origin: null, body: { email: 'a@b.test' } });
    expect(res.status).toBe(403);
  });

  it('rejects unknown fields in request bodies', async () => {
    const admin = await createUser({ platformAdmin: true });
    const res = await api('/events', {
      cookie: admin.cookie,
      body: { name: 'X', startsOn: '2026-12-01', endsOn: '2026-12-02', isAdmin: true },
    });
    expect(res.status).toBe(400);
  });

  it('sets security headers and hides internals on 404', async () => {
    const res = await api('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('configuration errors', () => {
  it('reports a missing AUTH_SECRET clearly instead of a generic error', async () => {
    const { app } = await import('../src/worker/index');
    const res = await app.request(
      '/api/auth/request',
      { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{"email":"a@b.test"}' },
      { ...testEnv, AUTH_SECRET: '' },
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe('not_configured');
  });

  it('reports email delivery failure clearly', async () => {
    const user = await createUser();
    const { app } = await import('../src/worker/index');
    const failing = {
      send: async () => {
        throw Object.assign(new Error('Sender domain not verified'), { code: 'E_SENDER_NOT_VERIFIED' });
      },
    };
    const res = await app.request(
      '/api/auth/request',
      { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }) },
      { ...testEnv, EMAIL: failing },
    );
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.error.code).toBe('email_unavailable');
    expect(body.error.message).toContain('E_SENDER_NOT_VERIFIED');
  });

  it('sends a structured sender, plain text and HTML through the binding', async () => {
    const user = await createUser();
    const { app } = await import('../src/worker/index');
    const sent: any[] = [];
    const binding = { send: async (m: unknown) => (sent.push(m), { messageId: 'x' }) };
    const res = await app.request(
      '/api/auth/request',
      { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }) },
      { ...testEnv, EMAIL: binding, EMAIL_FROM: 'CampCount <no-reply@campcount.com>' },
    );
    expect(res.status).toBe(200);
    expect(sent[0].from).toEqual({ name: 'CampCount', email: 'no-reply@campcount.com' });
    expect(sent[0].to).toBe(user.email);
    expect(sent[0].text).toMatch(/code is \d{6}/);
    expect(sent[0].html).toContain('http://localhost/sign-in/verify#t=');
  });
});

describe('parseSender', () => {
  it('handles named, quoted and bare addresses', async () => {
    const { parseSender } = await import('../src/worker/services/email');
    expect(parseSender('CampCount <no-reply@campcount.com>')).toEqual({ name: 'CampCount', email: 'no-reply@campcount.com' });
    expect(parseSender('"Camp Count" <a@b.com>')).toEqual({ name: 'Camp Count', email: 'a@b.com' });
    expect(parseSender('<a@b.com>')).toBe('a@b.com');
    expect(parseSender(' a@b.com ')).toBe('a@b.com');
  });
});

describe('passwords', () => {
  async function setPassword(cookie: string, password: string, currentPassword?: string) {
    return api('/auth/password', { cookie, body: currentPassword ? { password, currentPassword } : { password } });
  }

  it('lets a signed-in user set a password, then sign in with it', async () => {
    const user = await createUser();
    expect((await json(await api('/me', { cookie: user.cookie }))).user.hasPassword).toBe(false);
    expect((await setPassword(user.cookie, 'tent-pegs-and-billy-tea')).status).toBe(200);
    expect((await json(await api('/me', { cookie: user.cookie }))).user.hasPassword).toBe(true);

    const res = await api('/auth/password/sign-in', { body: { email: user.email.toUpperCase(), password: 'tent-pegs-and-billy-tea' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-cc_session=.*HttpOnly/);
  });

  it('stores a salted, peppered hash, never the password', async () => {
    const user = await createUser();
    await setPassword(user.cookie, 'tent-pegs-and-billy-tea');
    const row = await testEnv.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(user.id).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]{22}\$[0-9a-f]{64}$/);
    expect(row!.password_hash).not.toContain('billy');
  });

  it('gives the same answer for wrong passwords, unknown emails and accounts without a password', async () => {
    const withPw = await createUser();
    await setPassword(withPw.cookie, 'tent-pegs-and-billy-tea');
    const noPw = await createUser();
    const answers = await Promise.all([
      api('/auth/password/sign-in', { body: { email: withPw.email, password: 'wrong-password-123' } }),
      api('/auth/password/sign-in', { body: { email: 'nobody@example.test', password: 'wrong-password-123' } }),
      api('/auth/password/sign-in', { body: { email: noPw.email, password: 'wrong-password-123' } }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(400);
      expect((await json(res)).error.message).toBe('Email or password is incorrect.');
    }
  });

  it('rejects weak passwords', async () => {
    const user = await createUser();
    for (const weak of ['short', 'password12345', 'aaaaaaaaaaaa', `${user.email.split('@')[0]}-camp`]) {
      expect((await setPassword(user.cookie, weak)).status).toBe(400);
    }
  });

  it('needs the current password to change it once the session is no longer fresh, and signs out other devices', async () => {
    const user = await createUser();
    await setPassword(user.cookie, 'tent-pegs-and-billy-tea');
    const other = await api('/auth/password/sign-in', { body: { email: user.email, password: 'tent-pegs-and-billy-tea' } });
    const otherCookie = other.headers.get('Set-Cookie')!.split(';')[0]!;

    await testEnv.DB.prepare(`UPDATE sessions SET created_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ?`).bind(user.id).run();
    expect((await setPassword(user.cookie, 'a-new-campfire-song')).status).toBe(400);
    expect((await setPassword(user.cookie, 'a-new-campfire-song', 'tent-pegs-and-billy-tea')).status).toBe(200);
    expect((await api('/me', { cookie: otherCookie })).status).toBe(401);
    expect((await api('/me', { cookie: user.cookie })).status).toBe(200);
  });

  it('disabled users cannot sign in with a password', async () => {
    const user = await createUser();
    await setPassword(user.cookie, 'tent-pegs-and-billy-tea');
    await testEnv.DB.prepare(`UPDATE users SET status = 'disabled' WHERE id = ?`).bind(user.id).run();
    expect((await api('/auth/password/sign-in', { body: { email: user.email, password: 'tent-pegs-and-billy-tea' } })).status).toBe(400);
  });
});
