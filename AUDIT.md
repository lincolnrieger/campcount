# CampCount pre-deployment audit

20 November 2026. Branch `claude/quirky-hamilton-0pmzno`, one commit per
area. Goal: CampCount works reliably at camp, handles 300+ people at once,
and stays simple.

## Summary

| | Count |
| --- | --- |
| Found (all severities) | 24 |
| Fixed and tested | 18 |
| Left open, needing your decision or a later pass | 6 |
| Tests | 175 before, 186 after, all passing |
| Lint, typecheck, build | Pass |

**Go/no-go: GO for the next camp**, once these are done:

1. Upgrade Cloudflare to **Workers Paid** (US$5 a month). The free plan's
   database cap would be hit during a camp. See [DEPLOY.md](DEPLOY.md) §1.
2. Merge this branch.
3. Do the dry run with real phones, and the restore rehearsal
   ([DEPLOY.md](DEPLOY.md) §5).

## Stack and routes (inventory)

- **Hosting:** one Cloudflare Worker.
  - API: Hono 4.13.19, in `src/worker`.
  - App: React 19 single-page app with react-router 7, in `src/web`.
  - Database: Cloudflare D1 (SQLite), with 16 migrations.
  - Also: Cloudflare Email Service, three rate-limit bindings, and a daily
    cron at 03:17 UTC.
- **Third parties:** none. No analytics, no external scripts, no fonts from
  CDNs.
- **Environment values:** `AUTH_SECRET` (secret); `ENVIRONMENT`,
  `ROOT_DOMAIN` and `EMAIL_FROM` (variables); bindings `DB`, `EMAIL`,
  `AUTH_LIMITER`, `AUTH_NETWORK_LIMITER` and `PUBLIC_NETWORK_LIMITER`.
- **Public routes (no account):**
  - `/api/health` and `/api/site`.
  - `/api/auth/*` (sign-in).
  - `/api/public/signup/*` (participants, holding a lanyard or its code).
  - `/api/stations/pair`.
- **Everything else** needs a signed-in staff account or a paired station,
  and passes `requirePermission` for that camp. `/api/admin/*` needs a
  platform permission and is unreachable from a camp's own address.
- **Sensitive data:** dietary entries (health), photo consent, extra
  imported columns, member numbers and names of children. The data map and
  retention rules are in `docs/requirements.md` §3 and §8. The threat
  model is in `docs/architecture.md` §5.

## Findings

Severity follows the review prompt: **Critical** means participant data
exposure, a cross-camp leak, or the gate or meals failing on the day.

| ID | Sev | Area | Where | Problem | Fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| L-1 | Critical | Load | `routes/auth.ts`, `routes/signup.ts`, `routes/scans.ts` | Sign-in, pairing and **all participant sign-up** allowed 10 requests a minute per internet address. A camp's phones share one address (camp Wi-Fi or mobile carrier), so a sign-up rush would stop after about 10 people. | Tight limit per person or email (10/min); per-address ceiling of 300/min (staff) or 1,500/min (sign-up). `src/worker/lib/rateLimit.ts`. | Fixed. Test: 60 participants on one address all succeed. Fails on the old code. |
| L-2 | Critical | Load / cost | Cloudflare plan | Free plan: 5M database rows read per day. The live dashboard reads every scan every 30 seconds per screen, so the cap is hit mid-camp and the database stops answering until midnight UTC. Free CPU (10 ms) is also below what password sign-in needs. | Upgrade to Workers Paid. Dashboards also made cheaper (P-3). | **You:** [DEPLOY.md](DEPLOY.md) §1 |
| S-1 | High | Security | `routes/roster.ts`, `services/rosterWrites.ts` | People records are shared across camps by membership number. Import, add-by-hand and edit all overwrote names, so **Camp A could rename a child on Camp B's roster and lanyards**. | Names of someone also on another camp change only if the editor can edit every camp they're on. Otherwise: kept on import and add, refused (with a clear message) on edit. | Fixed. `test/crossCamp.test.ts`, which fails on the old code. |
| S-2 | High | Privacy | `routes/staff.ts:82` | Any camp manager could list the name and email of every account on the platform. | List only people who've worked on camps this manager runs. Platform admins see all. Anyone can still be added by email. | Fixed. Test in `accounts.test.ts`. |
| P-1 | High | Load | `migrations/` | Every sign-up request read every booking in every camp (no index on bookings by person). | Migration `0016_load_indexes.sql` (additive): bookings by person and by camp, registrations by person, scans by card. | Fixed. Verified with `EXPLAIN QUERY PLAN`. |
| S-3 | High | Supply chain | `package-lock.json` | Hono 4.13.13 had advisories, including a router bug that can skip `*` middleware. CampCount's site wall, session and CSRF checks are `*` middleware. | Hono 4.13.19 (patch). Dev tools updated within their ranges. | Fixed. `npm audit`: 0. |
| P-2 | Medium | Load | `routes/scans.ts` | A 200-scan upload ran up to 200 separate card lookups. | Looked up in batches of 90 with `IN (…)`. | Fixed. Test: 200 scans uploaded twice are stored once. |
| P-3 | Medium | Load | `routes/reports.ts` | `/live` and `/whereabouts` each loaded every scan, for every open home screen, every 30 seconds. | Reuse the loaded camp for up to 5 seconds (in memory, after the permission check). Cleared by scans through the same instance. A director's own "mark arrived" fetches fresh. | Fixed. Test: an arrival shows straight away. |
| P-4 | Medium | Load | `EventHome`, `ActivityRoster`, `Signup`, `useScanSession` | Polling ran in background tabs and in lockstep across devices. | `usePolling`: pauses when the tab is hidden or the device is offline, ±20% jitter, and refreshes on return. | Fixed. |
| P-5 | Medium | Load | `offline/sync.ts` | Failed uploads retried every 10 seconds, and every phone retried at once when signal returned. | Backoff from 10 s up to 5 min, with jitter. Uploads spread over 3 s after signal returns. A new scan still tries at once. | Fixed. |
| S-4 | Medium | Security | `ParticipantLinks.tsx`, `Import.tsx` | CSVs made in the browser didn't neutralise formulas, so a name like `=HYPERLINK(…)` would run in Excel. | The shared `csvCell` used everywhere. | Fixed. |
| S-5 | Medium | Privacy | `services/maintenance.ts` | The 90-day purge kept extra imported columns, which can hold medical or contact details. | Cleared in the 90-day stage. | Fixed. Retention test extended. |
| S-6 | Medium | Privacy | `session.tsx`, `offline/sync.ts` | When a sign-in expired or was revoked on the server, the offline list (names, dietary alerts) stayed on the phone. | Wiped on any 401. Waiting scans are kept to upload after signing in. Sign-out warns if the wipe fails. | Fixed. |
| S-7 | Low | Security | `routes/signup.ts` | Replacing a lost lanyard left its sign-up pass valid for up to 30 minutes. | The pass names its lanyard and is checked on every use. | Fixed. Test in `signup.test.ts`. |
| S-8 | Low | Privacy | `routes/auth.ts:123` | An email failure logged the provider's message, which can include the recipient. | Logs the error code only. | Fixed. |
| O-1 | Medium | Monitoring | `index.ts` | The health check didn't touch the database. Errors had no reference. Rate limiting and cron failures were invisible in logs. | The health check queries the database. Every response has `X-Request-Id`, shown on errors. JSON logs for `unhandled`, `rate_limited`, `maintenance_done` and `maintenance_failed`. | Fixed. |
| O-2 | Low | Metadata | `public/` | A private tool, but indexable. | `noindex` meta and header (`robots.txt` blocks only `/api/`, so search engines can read the noindex), `security.txt`. | Fixed. **You:** create the `security@campcount.com` mailbox or forwarder. |
| O-3 | Low | CI | `.github/workflows/ci.yml` | No secret scanning. Actions pinned to tags. | gitleaks job on the full history, a built-site secret grep, actions pinned to commit SHAs. | Fixed. **You:** turn on GitHub push protection. |
| A-1 | Low | Accessibility | `AdminLog.tsx` | On phones, people links in the activity log were under 44 px. | Full-size touch target. | Fixed. UI check: all 33 screens pass at phone and desktop width. |
| S-9 | Medium | Security | `routes/scans.ts:45` | The scanner's offline list holds a fast hash of each lanyard's 8-character printed code. Someone with a scanner phone could recover every code offline and use them at the public sign-up screen to book as any child. | Options: a slow hash, longer codes, or not sending code hashes to stations. Each changes how typed codes work on scanners. | **Open: needs your decision.** Low real-world risk: it needs a staff phone, technical skill, and the sign-up code. |
| S-10 | Medium | Privacy | `routes/admin.ts:244` | The platform activity log shows participants' names and scan places across all camps. The platform-admin role description says admins don't see participant data. | Either hide names there, or change the documented policy. | **Open: policy decision for you and the organisation's privacy officer.** |
| S-11 | Low | Security | `middleware/security.ts:35` | The 2 MB body cap trusts `Content-Length`. A chunked request isn't capped there, though Cloudflare still caps request size. | Count bytes in `parseBody`. | Open (low). |
| S-12 | Low | Privacy | `routes/auth.ts:43` | While email sending is broken, "request a code" answers differently for existing accounts (503). | Answer the same either way and alert the operator. | Open (low). |
| D-1 | Low | Docs | `docs/architecture.md` | It mentions Turnstile and a staging environment. Neither exists. | Don't put Turnstile on a shared kiosk. Add staging if you want one (another D1 database, still within the paid plan). | Open: your call. |

## Load evidence

**Unit tests**, run inside the Workers runtime against real D1
(`test/load.test.ts`, `test/scans.test.ts`):

- 60 participants behind one address identify and book with 0 refusals.
- One person making 14 quick changes is limited.
- 40 people racing for 10 places get exactly 10. The other 30 are told
  it's full.
- One booking sent 10 times at once is stored once.
- 200 queued scans uploaded twice are stored once.

**Local load run**, using `scripts/load/signup-rush.mjs` against
`npm run dev` with a 450-person demo camp. The scenario:

- 300 participants opening their links and booking within 60 seconds.
- 5 sign-up screens polling.
- 6 gate scanners each uploading every 2 seconds for a minute.

| Request | Count | p50 | p95 | Result |
| --- | --- | --- | --- | --- |
| identify (open lanyard link) | 300 | 23 ms | 75 ms | all 200 |
| book | 109 | 26 ms | 48 ms | 40 booked, 69 "full or clashes" (expected) |
| sign-up board | 17 | 18 ms | 209 ms | all 200 |
| gate scan upload | 174 | 82 ms | 156 ms | all 200 |

0 server errors, 0 rate-limited, and no session over capacity.

**Not verified:** local numbers don't predict production latency. Run the
script once against a test deployment ([DEPLOY.md](DEPLOY.md) §5).

## Conflict rules

What happens when two people change the same thing:

- **Scans:** append-only, with ids made on the device, so retries never
  duplicate. Two offline phones are reconciled on upload. Corrections are
  new records.
- **Bookings and teams:** the database enforces capacity and team size in
  a single statement, so the first to arrive wins and the rest are told
  it's full.
- **Names, groups and other details:** last write wins. Shared names
  follow S-1.

## Not done in this pass (honestly)

- **Real phones:** no iPhone or Android camera tests in sunlight. Do this
  in the dry run.
- **Restore:** not rehearsed. There's no access to the Cloudflare account
  from here.
- **Lighthouse:** no Core Web Vitals measurements. The main JavaScript
  bundle is 140 KB gzipped. The PDF, QR-decoder and spreadsheet code load only on
  the screens that use them.
- **Design:** no screen-by-screen redesign. The design system in
  `rebuild/` is already applied. The UI check (axe accessibility,
  touch-target size and sideways-scroll checks) passes on all 33 screens
  at phone and desktop width (66 checks). Nothing was restyled, in keeping with "simple" and
  "don't rewrite".
