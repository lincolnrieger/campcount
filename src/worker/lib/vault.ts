/**
 * Participant data is encrypted before it reaches the database.
 *
 * - Names, participant IDs, groups, levels, car registrations and dietary
 *   details are sealed with AES-256-GCM (a fresh random IV each time) under a
 *   key derived from the DATA_KEY secret. The database only ever holds
 *   `enc1.<base64url>` values for these.
 * - Participant IDs also get a keyed hash (HMAC-SHA-256) so people can be
 *   found and matched without storing the ID in readable form.
 * - Reads are decrypted in the Worker's memory by `withVault`, which wraps
 *   the database binding: any value (or value inside JSON, or joined text)
 *   that is a sealed token comes back as plain text. Code that writes
 *   personal fields calls `seal` explicitly.
 *
 * DATA_KEY is separate from AUTH_SECRET on purpose: rotating the sign-in
 * secret must never make participant data unreadable. Losing DATA_KEY makes
 * it unreadable for good, so keep a copy somewhere safe.
 */

const encoder = new TextEncoder();
const PREFIX = 'enc1.';
const TOKEN = /enc1\.[A-Za-z0-9_-]{22,}/g;

interface VaultKeys {
  aes: CryptoKey;
  hmac: CryptoKey;
}
const keyCache = new Map<string, Promise<VaultKeys>>();
/** Decrypted values, so dashboards that refresh every 30 seconds don't decrypt the same names again. */
const plainCache = new Map<string, string>();
const PLAIN_CACHE_MAX = 50_000;

export class MissingDataKey extends Error {
  constructor() {
    super('DATA_KEY is not set. Set it in Cloudflare (Settings › Variables and Secrets) before using CampCount.');
  }
}

function keys(secret: string | undefined): Promise<VaultKeys> {
  if (!secret || secret.length < 32) throw new MissingDataKey();
  let p = keyCache.get(secret);
  if (!p) {
    p = (async () => {
      const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
      const derive = (info: string, alg: Parameters<SubtleCrypto['deriveKey']>[2], usages: string[]) =>
        crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) }, base, alg, false, usages);
      return {
        aes: await derive('campcount participant data v1', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
        hmac: await derive('campcount participant lookup v1', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
      };
    })();
    keyCache.set(secret, p);
  }
  return p;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

export interface VaultEnv {
  DATA_KEY?: string;
}

/** Encrypt one value for storage. Empty stays empty (there's nothing to hide). */
export async function seal(env: VaultEnv, plain: string): Promise<string> {
  if (plain === '') return '';
  const { aes } = await keys(env.DATA_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  const token = PREFIX + b64url(out);
  remember(token, plain);
  return token;
}

/** Encrypt several values at once (same order). */
export function sealAll(env: VaultEnv, values: string[]): Promise<string[]> {
  return Promise.all(values.map((v) => seal(env, v)));
}

function remember(token: string, plain: string) {
  if (plainCache.size >= PLAIN_CACHE_MAX) plainCache.clear();
  plainCache.set(token, plain);
}

async function openToken(env: VaultEnv, token: string): Promise<string> {
  const hit = plainCache.get(token);
  if (hit !== undefined) return hit;
  const { aes } = await keys(env.DATA_KEY);
  try {
    const bytes = fromB64url(token.slice(PREFIX.length));
    const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, aes, bytes.slice(12)));
    remember(token, pt);
    return pt;
  } catch {
    // Not one of ours (someone typed something that looks like a token): leave it as it is.
    return token;
  }
}

export const isSealed = (v: unknown): boolean => typeof v === 'string' && v.startsWith(PREFIX);

/** Decrypt a stored value, or a text holding sealed values (joined text, JSON). Plain text passes through. */
export async function open(env: VaultEnv, value: string): Promise<string> {
  if (!value.includes(PREFIX)) return value;
  if (isSealed(value) && /^enc1\.[A-Za-z0-9_-]+$/.test(value)) return openToken(env, value);
  const first = value.trimStart()[0];
  if (first === '[' || first === '{') {
    try {
      return JSON.stringify(await openDeep(env, JSON.parse(value)));
    } catch {
      // not JSON after all: fall through to token replacement
    }
  }
  const tokens = [...new Set(value.match(TOKEN) ?? [])];
  const plain = await Promise.all(tokens.map((t) => openToken(env, t)));
  let out = value;
  tokens.forEach((t, i) => (out = out.split(t).join(plain[i]!)));
  return out;
}

async function openDeep(env: VaultEnv, v: unknown): Promise<unknown> {
  if (typeof v === 'string') return v.includes(PREFIX) ? open(env, v) : v;
  if (Array.isArray(v)) return Promise.all(v.map((x) => openDeep(env, x)));
  if (v && typeof v === 'object') {
    const entries = await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await openDeep(env, x)] as const));
    return Object.fromEntries(entries);
  }
  return v;
}

/** Decrypt every sealed value in a result row (or rows), in place. */
export async function openRows<T>(env: VaultEnv, rows: T): Promise<T> {
  const list = (Array.isArray(rows) ? rows : [rows]) as unknown[];
  const jobs: Promise<void>[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown> | unknown[];
    for (const k of Object.keys(r)) {
      const v = (r as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.includes(PREFIX)) jobs.push(open(env, v).then((p) => void ((r as Record<string, unknown>)[k] = p)));
    }
  }
  await Promise.all(jobs);
  return rows;
}

/** Participant IDs compared without spaces, case or leading zeros (spreadsheets drop them). */
export const normaliseParticipantId = (id: string) => id.replace(/\s+/g, '').toUpperCase().replace(/^0+(?=.)/, '');

/** A keyed hash for finding an encrypted value: the same text always gives the same hash, which reveals nothing without DATA_KEY. */
export async function lookupKey(env: VaultEnv, purpose: string, text: string): Promise<string> {
  const { hmac } = await keys(env.DATA_KEY);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(`${purpose}:${text}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The keyed hash used to find someone by participant ID. */
export function participantKey(env: VaultEnv, id: string): Promise<string> {
  return lookupKey(env, 'participant', normaliseParticipantId(id));
}

/** The keyed hash used to find a lanyard by its typed code (already normalised). */
export function shortCodeKey(env: VaultEnv, code: string): Promise<string> {
  return lookupKey(env, 'card', code);
}

// ---------------------------------------------------------------- the database wrapper

const WRAPPED = Symbol('vault');
const INNER = Symbol('inner');

class VaultStatement {
  [INNER]: D1PreparedStatement;
  constructor(
    private env: VaultEnv,
    inner: D1PreparedStatement,
  ) {
    this[INNER] = inner;
  }
  bind(...values: unknown[]): VaultStatement {
    return new VaultStatement(this.env, this[INNER].bind(...values));
  }
  async first<T = unknown>(column?: string): Promise<T | null> {
    if (column !== undefined) {
      const v = await this[INNER].first<T>(column);
      return (typeof v === 'string' ? ((await open(this.env, v)) as T) : v) as T | null;
    }
    const row = await this[INNER].first<T>();
    return row ? openRows(this.env, row) : row;
  }
  async all<T = unknown>(): Promise<D1Result<T>> {
    const res = await this[INNER].all<T>();
    await openRows(this.env, res.results);
    return res;
  }
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const rows = (await (options?.columnNames ? this[INNER].raw<T>({ columnNames: true }) : this[INNER].raw<T>())) as T[];
    await openRows(this.env, rows);
    return rows;
  }
  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this[INNER].run<T>();
  }
}

/** The database binding, with sealed values decrypted on the way out. */
export function withVault(db: D1Database, env: VaultEnv): D1Database {
  if ((db as unknown as { [WRAPPED]?: boolean })[WRAPPED]) return db;
  const wrapped = {
    [WRAPPED]: true,
    prepare: (sql: string) => new VaultStatement(env, db.prepare(sql)),
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const inner = statements.map((s) => (s as unknown as VaultStatement)[INNER] ?? s);
      const results = await db.batch<T>(inner);
      await Promise.all(results.map((r) => (r.results ? openRows(env, r.results) : null)));
      return results;
    },
    exec: (sql: string) => db.exec(sql),
    dump: () => (db as unknown as { dump: () => Promise<ArrayBuffer> }).dump(),
    withSession: (c?: string) => withVault((db as unknown as { withSession: (c?: string) => D1Database }).withSession(c), env),
  };
  return wrapped as unknown as D1Database;
}
