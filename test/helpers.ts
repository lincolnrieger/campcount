import { env, exports } from 'cloudflare:workers';
import { createSession } from '../src/worker/services/sessions';
import type { Env } from '../src/worker/env';

export const ORIGIN = 'https://campcount.test';
export const testEnv = env as unknown as Env;

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

export async function createUser(opts: { platformAdmin?: boolean; name?: string } = {}): Promise<TestUser> {
  const id = crypto.randomUUID();
  const email = `user-${unique()}@example.test`;
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    // Signed-in users have confirmed their email (by code or link).
    `INSERT INTO users (id, email, display_name, email_verified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, email, opts.name ?? 'Test User', now, now, now)
    .run();
  if (opts.platformAdmin) {
    await grant(id, 'platform_admin', null);
  }
  const { token } = await createSession(testEnv, { userId: id });
  return { id, email, cookie: `__Host-cc_session=${token}` };
}

export async function grant(userId: string, roleKey: string, eventId: string | null, activityId: string | null = null) {
  await testEnv.DB.prepare(
    `INSERT INTO assignments (id, user_id, role_id, event_id, activity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, `role_${roleKey}`, eventId, activityId, new Date().toISOString())
    .run();
}

export async function createEvent(createdBy: string, overrides: Partial<{ status: string; name: string }> = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO events (id, slug, name, starts_on, ends_on, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '2026-12-05', '2026-12-07', ?, ?, ?, ?)`,
  )
    .bind(id, `ev-${unique()}`, overrides.name ?? 'Test Camp', overrides.status ?? 'draft', createdBy, now, now)
    .run();
  return id;
}

export async function createActivity(eventId: string, name = 'Kayaking') {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO activities (id, event_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, eventId, name, now, now)
    .run();
  return id;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

export async function api(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (method !== 'GET' && opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  return (exports as unknown as { default: Fetcher }).default.fetch(new Request(`${ORIGIN}/api${path}`, { method, headers, body }));
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A custom role for testing permission edges that the built-in roles don't isolate. */
export async function createRole(key: string, permissions: string[], scope: 'event' | 'activity' = 'event') {
  await testEnv.DB.prepare(`INSERT OR IGNORE INTO roles (id, key, name, scope, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(`role_${key}`, key, key, scope, new Date().toISOString())
    .run();
  for (const p of permissions) {
    await testEnv.DB.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)`).bind(`role_${key}`, p).run();
  }
}
