# CampCount — Architecture (draft for approval)

Status: **Draft v0.1, 2026-10-23.**

## 1. Shape

```
Browser (React SPA + service worker)
  ├─ Admin / Director screens ─────── online only
  ├─ Scan screens ── IndexedDB queue + context cache ── sync when online
  └─ Import: CSV parsed + filtered in-browser; only allowlisted fields sent
        │  HTTPS, session cookie
        ▼
Cloudflare Worker (single deployment)
  ├─ Static assets (the SPA)
  ├─ Hono API: auth → session → permission check → service → D1
  ├─ Rate limiting binding, Turnstile (public sign-up only)
  └─ Cron: retention purge, session cleanup
        ▼
Cloudflare D1 (location hint: Oceania) — Time Travel point-in-time restore
```

Stack: TypeScript everywhere.
- **Frontend**: Vite + React.
- **Server**: Hono.
- **Database**: hand-written, parameterised SQL through D1 prepared
  statements (no ORM: the SQL stays reviewable). Migrations are SQL files
  reviewed in Git and applied with `wrangler d1 migrations`.
- **Validation**: Zod schemas shared by client and server.
- **Tests**: Vitest with `@cloudflare/vitest-pool-workers`, plus Playwright.
- **CI/CD**: GitHub Actions, with dev, staging and prod environments.

Why one Worker: it is one deployable unit, with no CORS and same-origin
cookies. At 4 events/year of ~400 people, nothing larger is justified.

## 2. Data model (Release 1)

Global (not event-scoped):
- `users` (staff accounts: email, display name, status)
- `sessions` (hashed id, user or station, expiry, revoked)
- `login_codes`
- `roles`, `role_permissions`
- `people` (member_number UNIQUE, names) — minimal and non-sensitive
- `audit_log` (append-only, enforced by database triggers)

Event-scoped (every row carries `event_id`; every query filters on it):
- `events` (dates, `Australia/Adelaide` timezone, lifecycle status, feature
  flags)
- `assignments` (user × role × event, optionally × activity)
- `registrations` (event × person UNIQUE): kind, group, section, position,
  photo_consent, status
- `dietary_entries` (registration, category, item, severity, note) —
  **sensitive**
- `credentials` (registration, token_hash UNIQUE, short_code UNIQUE per
  event, revoked_at)
- `activities`, `activity_bookings`, `meal_services`
- `stations` (paired device: one context, expiry, revoked)
- `scans` — append-only, with these fields:
  - `id`: client-generated UUID, the primary key, which gives idempotency
  - `event_id`
  - `context_type` (activity / meal / site) and `context_id`
  - `registration_id`, `direction`
  - `device_time`, `server_time`
  - `actor` (user or station)
  - `outcome`
  - `supersedes_id`, `reason` (for corrections)
- `import_jobs` (counts and summary only, no row data)

Counts and reports are always computed from `scans`. There are no stored
counters.

## 3. Offline scanning design

1. **Load the context.** When a scan screen opens online, it downloads that
   context's roster: `token_hash → {display name, member no., group,
   photo flag, [dietary alert for meal devices]}`. The data is stored in
   IndexedDB.
2. **Scan.** The device hashes the scanned token with WebCrypto, looks it up
   locally, and applies the duplicate rules locally. Feedback is instant
   with or without a connection.
3. **Queue.** The scan is written to the IndexedDB outbox with a UUID before
   any feedback is shown, so it survives a reload or crash.
4. **Sync.** The outbox is posted in batches. The server inserts with
   `ON CONFLICT(id) DO NOTHING`, so retries are harmless. It re-checks
   permission, credential validity and duplicates, and returns the final
   outcome per scan. The device reconciles its local state.
5. **Clocks.** Both device time and server time are stored. Large skew is
   flagged.
6. **Revocation.** A station or user that has been revoked can still upload
   its queued scans. Scans dated after revocation are marked for review,
   not trusted automatically.
7. **Loss.** Signing out, closing the event, or revoking remotely clears the
   cache the next time the device connects. The cache holds no raw tokens
   and only the minimum display fields. Release 1 is not resistant to a
   stolen, unlocked phone; this is documented as a known limitation.

## 4. Authentication

- Staff sign in with an **emailed 6-digit code**. A link is also sent, but
  it opens a page that needs a button press, so Microsoft Defender Safe
  Links pre-fetching cannot consume it.
- Sessions are server-side.
- The cookie is `__Host-` prefixed, `HttpOnly`, `Secure` and
  `SameSite=Strict`. Idle timeout is 12 h and absolute timeout 7 days
  (event scanning devices).
- Role changes apply on the next request, because permissions are looked up
  per request and never stored in the session.
- **Station pairing**: the Director shows a one-time QR. A device scans it
  and gets a station session limited to one context. The session expires at
  event end by default.
- Email sending: Cloudflare Email Service if it is available on the
  account, otherwise a transactional provider. To be confirmed during
  foundation.

## 5. Threat model (summary)

| Threat | Control |
|---|---|
| Cross-event access / IDOR | Every event-scoped service function takes `eventId` from the authorised assignment, not from the client. Isolation tests. |
| Over-broad data to volunteers | Scan responses use per-role DTOs. Scanners and Meal team never get export endpoints. |
| Sensitive data in import | Browser-side allowlist; the server rejects unknown fields (strict Zod). |
| Forged or guessed QR | 128-bit random tokens; only hashes stored; revocation; scans need an authenticated scanner. |
| Public sign-up abuse | Only open while the Director enables it; Turnstile; rate limits; requires a valid lanyard code. |
| XSS / CSRF / injection | React escaping, strict CSP, SameSite=Strict + Origin check, parameterised queries only. |
| Brute force on login / codes | Rate limiting per IP and email; codes expire in 10 min; 5 attempts. |
| Insider misuse | Audit log of exports, corrections, role changes and imports; dietary named list restricted. |
| Data loss | D1 Time Travel (30-day point-in-time restore) plus a pre-event and post-event export; restore rehearsed before December. |
| Secrets | Wrangler secrets per environment; no real data in dev or staging (synthetic seed only). |

## 6. Delivery plan to December

| Week (from) | Deliverable |
|---|---|
| 27 Oct | Foundation: repo, CI, schema and migrations, auth, RBAC, design tokens, staging deploy |
| 3 Nov | Events, browser import plus dietary review, roster, lanyard printing |
| 10 Nov | Scan engine, offline outbox, activity scanning |
| 17 Nov | Meal and site scanning, station pairing, live counts |
| 24 Nov | Close-out, exports, (self-sign-up if confirmed), security and permission test pass |
| 1 Dec | Dry run with real phones and a no-signal test, fixes, production deploy, paper-fallback sheets |
