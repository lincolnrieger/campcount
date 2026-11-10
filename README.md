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
- QR lanyards (print four per A4, double-sided) with typed backup codes. Each
  event can download a blank template, design its own artwork and upload it in
  Settings › Lanyards; until then the built-in design is used. There, the
  event can also place the text itself: drag the name, Leader or Youth word
  (from each person's role), group, QR code and typed code on a preview, and
  set each one's colour, size and alignment. The PDF prints exactly that A marker for no
  photo consent is chosen there too
- Team events (Soccer, Basketball…): people make and join teams from their
  lanyard link or the sign-up kiosk, within team size limits
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
npx wrangler d1 execute DB --local --env dev --file=/tmp/admin.sql
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

## Deploying

Production is the top-level config in `wrangler.jsonc`, so Cloudflare
Workers Builds deploys it on every merge to `main`.

In the Cloudflare dashboard, open Workers & Pages, then campcount, then
Settings:

- **Build configuration**
  - Build command: `npm run build`
  - Deploy command: `npm run deploy` (applies migrations, then deploys)
- **Variables and Secrets:** add a **secret** `AUTH_SECRET` (64 random hex
  characters). It signs sign-in codes and encrypts card tokens.
- **Email Service:** enable sending for the domain the `EMAIL_FROM` address
  uses, so sign-in codes can be emailed.
- **Domains:** attach `campcount.com` once the domain is on the account.
  Until then the app runs at the workers.dev address, and camps open at
  `/events/<id>` instead of their own address.

### Camp addresses (summercamp.campcount.com)

Each camp can have its own address. It shows only that camp, with its own
name, colour and logo. `campcount.com` itself is the admin console. One-time
setup, once `campcount.com` is on the Cloudflare account:

1. **DNS:** add a record for `*` (wildcard). Type `AAAA`, content `100::`,
   proxied (orange cloud).
2. **Workers route:** open Workers & Pages, then campcount, then Settings,
   then Domains & Routes. Add a route `*.campcount.com/*` for zone
   `campcount.com`.
3. **Certificate:** Cloudflare's Universal SSL covers `campcount.com` and
   `*.campcount.com`, so nothing else is needed.

`ROOT_DOMAIN` in `wrangler.jsonc` must match the domain: `campcount.com` in
production, `localhost` in development.

Then, in the admin console, set each camp's address under Camps, then the
camp. Sign-ins are separate per address: staff sign in at their camp's
address.

Locally, try a camp's address at `http://<address>.localhost:5173`.
Chrome and Firefox send `*.localhost` to your own computer.

To create the first administrator, run the SQL from
`scripts/create-admin.mjs` against the production database with
`npx wrangler d1 execute DB --remote --file=<file>`.
