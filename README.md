# CampCount

Camp and event operations for Scouts SA: rosters, QR lanyards, activity and
meal scanning that keeps working with patchy signal, and close-out reports.

- Requirements: [`docs/requirements.md`](docs/requirements.md)
- Architecture and threat model: [`docs/architecture.md`](docs/architecture.md)
- Decisions: [`docs/discovery/decision-log.md`](docs/discovery/decision-log.md)
- Running an event, incidents, backup and restore: [`docs/operations.md`](docs/operations.md)
- Known limitations: [`docs/known-limitations.md`](docs/known-limitations.md)

## What works today

- Passwordless sign-in, event-scoped roles, staff assignment without
  privilege escalation, append-only audit log
- Events with per-event features and a draft → open → completed → archived
  lifecycle
- MyScout import (.xlsx/CSV) filtered in the browser, with dietary review
- QR lanyards (print four per A4) with typed backup codes; card replacement
- Scanning for activities, meals and on-site, working offline, on personal
  phones or paired shared stations
- Live dashboard, reconciliation, close-out, CSV exports, paper roll sheets
- Automatic retention purges

## Stack

One Cloudflare Worker serves both the API (Hono, `src/worker`) and the React
single-page app (`src/web`), backed by Cloudflare D1. Shared validation and
permission definitions live in `src/shared`. Migrations are plain SQL in
`migrations/`.

## Local development

Requires Node 22.

```sh
npm install
printf 'AUTH_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > .dev.vars
npm run db:migrate:local
node scripts/create-admin.mjs "Your Name" you@example.com > /tmp/admin.sql
npx wrangler d1 execute DB --local --file=/tmp/admin.sql
npm run dev
```

Open http://localhost:5173 and sign in. In development, sign-in emails are
printed to the terminal instead of being sent.

## Checks

```sh
npm run lint
npm run typecheck
npm test        # runs inside the Workers runtime against a real local D1
npm run build
```

## Data rules for contributors

- **Never commit real participant data.** CSV and Excel files are git-ignored.
  Test fixtures must be invented.
- Every API route must call `requirePermission` before touching data.
  Permissions are listed in `src/shared/permissions.ts`; the approved matrix
  is enforced by `test/roles.test.ts`.
- Audit `detail` must hold identifiers and counts only, never names, dietary
  information or contact details.
- Don't log request bodies.

## Deploying (not yet configured)

1. Create D1 databases `campcount-staging` and `campcount-production`
   (location hint: Oceania) and put their ids in `wrangler.jsonc`.
2. Set the auth secret: `npx wrangler secret put AUTH_SECRET --env <env>`.
3. Enable Cloudflare Email Service for `campcount.com` and add a
   `send_email` binding named `EMAIL` to each environment.
4. `npx wrangler d1 migrations apply DB --env <env> --remote`, then
   `npm run deploy:<env>`.
5. Create the first administrator with `scripts/create-admin.mjs` and
   `wrangler d1 execute --env <env> --remote`.
