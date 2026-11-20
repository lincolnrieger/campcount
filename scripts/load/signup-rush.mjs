#!/usr/bin/env node
/**
 * Load test: a whole camp opening activity sign-up at once.
 *
 * NEVER run this against production or a camp with real people in it.
 * Use a test deployment (or `npm run dev`) with a demo camp:
 *   1. Sign in as a platform admin, open Demo camps, and make a demo camp
 *      with 400 participants.
 *   2. Open the demo camp, then People › ⋯ › Participant links › Download.
 *   3. Run:
 *        node scripts/load/signup-rush.mjs --base https://<test address> --links <downloaded.csv> --people 300
 *
 * Each virtual participant opens their own lanyard link, then books up to 3
 * sessions with places left, within about --spread seconds. Meanwhile
 * --boards sign-up screens poll the board every 30 seconds (needs --code,
 * the part after /signup/ in the sign-up screen's address).
 *
 * Optional gate scenario (needs a signed-in staff cookie for the demo camp,
 * copied from the browser's developer tools):
 *        --event <event id> --cookie "__Host-cc_session=..." --gates 6 --gate-minutes 2
 *
 * It prints how many requests got each status and how long they took.
 * Pass: no 5xx, no 429 for ordinary participants, p95 under 500 ms.
 * Every request carries the same Origin as --base, as a browser would.
 */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const base = (args.base ?? '').replace(/\/$/, '');
if (!base || !args.links) {
  console.error('Usage: node scripts/load/signup-rush.mjs --base <url> --links <participant-links.csv> [--people 300] [--spread 120]');
  process.exit(1);
}
if (/(^|\.)campcount\.com$/.test(new URL(base).hostname) && !args['i-know-this-is-a-test-camp']) {
  console.error('That looks like the live site. Use a test deployment, or add --i-know-this-is-a-test-camp if this is a demo camp.');
  process.exit(1);
}
const people = Number(args.people ?? 300);
const spreadMs = Number(args.spread ?? 120) * 1000;
const boards = Number(args.boards ?? 5);

// The CSV's last column is each person's link: https://…/c#<token>
const tokens = readFileSync(args.links, 'utf8')
  .split(/\r?\n/)
  .map((line) => /#([A-Za-z0-9_-]{22})/.exec(line)?.[1])
  .filter(Boolean)
  .slice(0, people);
if (tokens.length === 0) throw new Error('No lanyard links found in that CSV.');

const stats = new Map();
async function call(label, path, body, headers = {}) {
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const res = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch {
    status = 0; // network error
  }
  const ms = performance.now() - started;
  const s = stats.get(label) ?? { times: [], statuses: {} };
  s.times.push(ms);
  s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  stats.set(label, s);
  return { status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function participant(token) {
  await sleep(Math.random() * spreadMs);
  const me = await call('identify', '/public/signup/identify', { token });
  if (me.status !== 200) return;
  let view = me.json;
  const wanted = view.sessions.filter((s) => !s.full).sort(() => Math.random() - 0.5).slice(0, 3);
  for (const s of wanted) {
    await sleep(1000 + Math.random() * 4000); // reading the list, tapping
    const res = await call('book', '/public/signup/book', { pass: view.pass, activityId: s.id });
    if (res.status === 200) view = res.json;
  }
}

async function board(stopAt) {
  while (Date.now() < stopAt) {
    await call('board', `/public/signup/event/${args.code}`);
    await sleep(30_000 * (0.8 + Math.random() * 0.4));
  }
}

async function gate(stopAt) {
  const hash = (t) => createHash('sha256').update(`credential:${t}`).digest('hex');
  while (Date.now() < stopAt) {
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    await call(
      'gate scan',
      `/events/${args.event}/scans`,
      {
        deviceId: `load-${randomUUID().slice(0, 8)}`,
        scans: [
          { id: randomUUID(), contextType: 'site', contextId: null, direction: 'in', deviceTime: new Date().toISOString(), method: 'qr', credentialHash: hash(token) },
        ],
      },
      { Cookie: args.cookie },
    );
    await sleep(2000);
  }
}

const started = Date.now();
const stopAt = started + spreadMs + 30_000;
console.log(`${tokens.length} participants over ~${spreadMs / 1000}s against ${base}`);
await Promise.all([
  ...tokens.map(participant),
  ...(args.code ? Array.from({ length: boards }, () => board(stopAt)) : []),
  ...(args.event && args.cookie
    ? Array.from({ length: Number(args.gates ?? 6) }, () => gate(started + Number(args['gate-minutes'] ?? 2) * 60_000))
    : []),
]);

const pct = (xs, p) => xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]?.toFixed(0);
let failed = false;
for (const [label, s] of stats) {
  console.log(`${label.padEnd(10)} n=${String(s.times.length).padEnd(5)} p50=${pct(s.times, 50)}ms p95=${pct(s.times, 95)}ms statuses=${JSON.stringify(s.statuses)}`);
  const bad = Object.entries(s.statuses).filter(([code]) => code === '0' || code === '429' || code.startsWith('5'));
  if (bad.length || Number(pct(s.times, 95)) > 500) failed = true;
}
console.log(failed ? 'FAIL: errors, 429s or slow responses (see above).' : 'PASS');
process.exit(failed ? 1 : 0);
