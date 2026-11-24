# Deploying CampCount for a real camp

This is the short, ordered list. The detailed runbook is
[`docs/operations.md`](docs/operations.md).

## 1. Upgrade Cloudflare to Workers Paid (required)

The free plan will not hold a camp of 300–400 people:

| Limit (free plan) | What happens at camp |
| --- | --- |
| Database: 5 million rows read per day | One director's home screen re-reads every scan in the camp every 30 seconds. With ~20,000 scans that alone is tens of millions of rows a day. When the cap is hit, **the database stops answering until midnight UTC** (10:30 am in Adelaide). |
| 100,000 requests per day | 300 participants, the sign-up screens and 30 staff phones can pass this on a busy day. |
| 10 ms of CPU per request | Password sign-in deliberately uses more than this (it's what makes passwords hard to crack), so sign-ins can fail. |

**Workers Paid costs US$5 a month.** It includes 10 million requests and
25 billion database rows read a month, which is far more than CampCount
uses. You can turn it off after the camp season.

Steps:

1. Sign in at **dash.cloudflare.com** with the account that owns CampCount.
2. In the left menu, open **Workers & Pages**.
3. Find **Plans** (or the **Upgrade** button next to the plan name). Choose
   **Workers Paid**.
4. Enter a payment card and confirm.
5. Set a spending alert: open **Notifications** (bell icon, or Manage
   Account › Notifications) › **Add** › **Usage Based Billing**. Set it to
   about US$10, so you hear if anything unusual happens.

Nothing in CampCount needs to change for the upgrade. Limits apply to the
whole account straight away.

## 2. Put this update live

1. On GitHub, open a pull request from the `claude/quirky-hamilton-0pmzno`
   branch to `main` and merge it.
2. Cloudflare Workers Builds deploys it automatically. That run:
   - applies database migrations `0016_load_indexes.sql` (new indexes) and
     `0017_lanyard_designer.sql` (two new tables for lanyard designs and their
     images), `0018_scanner_bookings.sql` (scanners can add people to come)
     and `0019_side_quest.sql` (the Side Quest switch and its table) and `0020_member_number_codes.sql` (lanyard codes become membership numbers) and `0021_leader_roster.sql` (the leader roster) and `0022_event_banners.sql` (the participant page banner) and `0023_intake.sql` then `0024_drop_intake.sql` (Import & check now keeps nothing on the server) and `0025_youth_sections.sql` (which sections count as youth) and `0026_section_settings.sql` (camp section names, words and colours), `0027_team_locks.sql`, `0028_car_rego.sql` and `0029_booking_links.sql`. All
     only add things, so they're safe while the old version is running;
   - creates the two new rate limits (`AUTH_NETWORK_LIMITER`,
     `PUBLIC_NETWORK_LIMITER`) from `wrangler.jsonc`.
3. In Cloudflare, open **Workers & Pages › campcount › Deployments** and
   check the latest build succeeded.

## 3. Check settings in the dashboard

In **Workers & Pages › campcount › Settings**:

- **Variables and Secrets:** `AUTH_SECRET` is there as a **Secret**, 64
  random hex characters. The other values (`ENVIRONMENT`, `ROOT_DOMAIN`,
  `EMAIL_FROM`) come from `wrangler.jsonc`.
- **Domains & Routes:** `campcount.com` and the route `*.campcount.com/*`
  (see the README's Camp addresses section).
- **Email Service:** sending is enabled for `campcount.com`. SPF, DKIM and
  DMARC records are set on the domain (Cloudflare shows any that are
  missing).

Then open these in a browser:

- `https://campcount.com/api/health` should show `{"ok":true}`. If it
  shows `ok:false` or an error, the database or `AUTH_SECRET` isn't set up.
- `https://campcount.com/robots.txt` should show `Disallow: /api/` (pages stay fetchable so search engines can read their `noindex`).

## 4. Monitoring (15 minutes, once)

1. **Uptime monitor:** create a free account at an uptime service (for
   example UptimeRobot or Better Stack). Add an HTTP check on
   `https://campcount.com/api/health` every 5 minutes, alerting your phone
   and email.
2. **Logs:** Workers & Pages › campcount › **Observability**. Useful
   searches during camp:
   - `rate_limited`: real people being turned away. A few is normal. A
     steady stream means tell your administrator.
   - `unhandled`: server errors. Each has a `ref` that matches the
     reference shown to the person on screen.
   - `maintenance_failed`: the nightly clean-up failed.
3. **security.txt** gives `security@campcount.com` as the contact for
   security reports. Create that address, or forward it to you, using
   Cloudflare Email Routing.

## 5. Before the camp

**Two weeks before:**

1. Back up the database, and store the file encrypted:
   `npx wrangler d1 export campcount-production --remote --output=backup.sql`
2. **Rehearse a restore.** This has never been done. Restore into a
   scratch database and note how long it took (see `docs/operations.md`).
3. Do the dry run, with a **demo camp** and real phones:
   - iPhone and Android, outdoors in sun.
   - Scan at the gate, a meal and an activity.
   - Turn on airplane mode, scan 20 cards, turn it off, and check they
     upload.
   - Open sign-up on 10 or more phones on the camp Wi-Fi at once.
4. Optional, with someone technical: run the load test against a **test
   deployment** with a 400-person demo camp. Never run it against the live
   site with real people:
   ```sh
   node scripts/load/signup-rush.mjs --base https://<test address> --links <participant-links.csv> --people 300
   ```

**The day before:** back up again. Print paper roll sheets
(People › ⋯ › Print roll sheet).

**Morning of day 1:**

1. `/api/health` shows ok, and the uptime monitor is green.
2. Each scanning phone opens its scanner once **with signal**, so its
   offline list downloads.
3. One test scan at the gate shows on the director's home screen.

## 6. If something goes wrong

- **Scanning keeps working without signal.** Scans wait on the phone and
  upload later. If the server is down, keep scanning. Use paper roll
  sheets if a phone dies.
- **Roll back the app** (the database is untouched):
  - In the dashboard: Workers & Pages › campcount › **Deployments** ›
    the previous version › **Rollback**.
  - Or from a terminal: `npx wrangler rollback`.
- **Roll back the database** (only if data was damaged):
  - `npx wrangler d1 time-travel info campcount-production` lists restore
    points.
  - `npx wrangler d1 time-travel restore campcount-production --timestamp=<time before the problem>`
    restores to one.
  - Scans made after that time are lost from the server. Phones that
    still hold them will upload them again.
- **A suspected data breach:** follow "Security incident response" in
  `docs/operations.md`, and tell the organisation's privacy officer.

## Environment values (names only)

| Name | Kind | Where |
| --- | --- | --- |
| `AUTH_SECRET` | Secret | Dashboard › Variables and Secrets |
| `ENVIRONMENT` | Variable | `wrangler.jsonc` |
| `ROOT_DOMAIN` | Variable | `wrangler.jsonc` |
| `EMAIL_FROM` | Variable | `wrangler.jsonc` |
| `DB` | D1 binding | `wrangler.jsonc` (campcount-production) |
| `EMAIL` | Email binding | `wrangler.jsonc` |
| `AUTH_LIMITER`, `AUTH_NETWORK_LIMITER`, `PUBLIC_NETWORK_LIMITER` | Rate limits | `wrangler.jsonc` |
