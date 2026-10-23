# CampCount operations runbook

How to run an event with CampCount, what to do when things go wrong, and how
to recover the system. Keep a printed copy at camp HQ.

## Two weeks before camp

1. **Create the event** (platform admin) and add the Camp Director on the
   Staff tab. The director adds everyone else.
2. **Turn on only the features you need** (Overview tab).
3. **Import the roster** from MyScout (Roster tab, then Import roster). Use
   the full participant export, including adults.
   - If dietary requirements are switched on, review each note. Record food
     needs only; leave other medical information in MyScout.
   - Re-import whenever MyScout changes. Use "mark people not in this file as
     withdrawn" only with the complete, current export.
4. **Add activities and meals.** Assign activity leaders to their activity
   so they only see that one.
5. **Print lanyards** (Roster tab, then Lanyards). Print on A4 at 100%
   scale, four per sheet. Keep spare and unused cards secure: a card is
   enough to be scanned as that person.
6. **Print paper roll sheets** (Roster tab, then Paper roll sheet) for each
   meal and the gate. They are the fallback if phones fail. Store them
   securely.
7. **Dry run:** open the event, scan a few test cards on each volunteer's
   phone, including once in aeroplane mode, then use Close-out to check
   the scans arrived. Correct the test scans or reset before camp.

## Setting up volunteers' phones

- Volunteers sign in once with their email (a 6-digit code is sent). They
  should do this **with signal**, then open their scanner once so the list
  downloads to the phone.
- For shared devices (meal-hall tablet, gate phone), use **Stations**: the
  director creates a pairing code and the device opens `/pair`. A station
  can only scan one thing and stops automatically.
- Phones must allow camera access for the CampCount site. On iPhone:
  Settings, Safari, Camera, Allow.

## During camp

- **No signal:** keep scanning. Scans are saved on the phone and upload
  automatically when signal returns. The top of the scanner shows how many
  are waiting. **Don't sign out** while scans are waiting; they would be
  lost.
- **Card won't scan:** use "Type a code" (the code printed under the QR),
  or "Find by name". Manual entries are marked as such in reports.
- **Lost card:** Roster tab, then Replace next to the person. The old card
  stops working. Reprint from Lanyards.
- **Lost or stolen phone:**
  1. For a station, stop it on the Stations tab.
  2. For a volunteer's own phone, a platform admin disables or re-enables
     their account (People), which signs out every session immediately.
  3. Scans not yet uploaded from that phone are lost. Check the paper roll
     for that period.
- **Wrong person scanned:** a director opens Close-out and chooses "Don't
  count this scan", with a reason. The original stays on record.
- **Phones or system unavailable:** switch to the paper roll sheets. Write
  the time beside each tick. Afterwards, enter them with "Find by name".

### What scan records are and aren't

Scan records show who was scanned, where, by whom and when. They are **not**
proof of where someone is now and **not** a substitute for an emergency
headcount or roll call. In an emergency, follow the Scouts SA emergency
procedure and do a physical headcount.

## Close-out

1. Make sure every scanning phone has had signal and shows "All
   uploaded". Close-out lists each phone's last upload.
2. On Close-out, resolve each item:
   - people still signed in or on site
   - scans needing review
   - unknown cards
3. Download the reports you need. Every download is logged. Store files
   securely and delete them when no longer needed.
4. Close the event. It can be reopened for late corrections.
5. A platform admin archives the event when it is final. Archiving with
   unresolved items needs explicit confirmation, which is logged.

## Data retention (automatic)

| What | Deleted |
|---|---|
| Dietary requirements, photo consent, card data | 90 days after the event closes |
| Named attendance records and roster | 2 years after close (totals kept for annual reports) |
| Sign-in codes and expired sessions | Daily |
| Audit log | Kept 7 years |

The job runs daily at 03:17 UTC and records each purge in the audit log.

## Deployment, rollback and recovery

- **Deploy:** merge to `main`; CI runs lint, type checks, tests and the build.
  Production is deployed manually:
  1. `npx wrangler d1 migrations apply DB --env production --remote`
  2. `npm run deploy:production`
- **Roll back code:** `npx wrangler rollback --env production`, which
  returns to the previous Worker version. Migrations are written to be
  additive. If a migration must be undone, restore the database (below).
- **Back up before events:**
  1. Run `npx wrangler d1 export campcount-production --remote --output=backup.sql`
     the day before camp and after close-out.
  2. Store the file encrypted. It contains personal information.
- **Restore:** D1 Time Travel keeps 30 days of history:
  1. `npx wrangler d1 time-travel info campcount-production` shows
     restore points.
  2. `npx wrangler d1 time-travel restore campcount-production --timestamp=<ISO time>`
     restores to that time.
  3. Rehearse a restore into the staging database before the first event.
- **Secrets:** `AUTH_SECRET` signs sign-in codes and encrypts card tokens.
  If it leaks:
  1. Rotate it with `wrangler secret put AUTH_SECRET --env production`.
     This signs everyone out and makes stored card tokens unreadable.
  2. Reissue and reprint every card for any open event.

## Security incident response

1. **Contain:**
   - Disable affected accounts (People).
   - Stop stations.
   - If needed, close the event to stop scanning.
2. **Assess:**
   - A platform admin reviews the audit log for the period: sign-ins,
     exports, role changes and corrections.
   - Cloudflare logs hold request metadata only. No request bodies are
     logged.
3. **Notify:**
   - Tell the Scouts SA privacy officer immediately.
   - Under the Notifiable Data Breaches scheme, Scouts SA decides whether
     an eligible data breach has occurred and must assess it within 30
     days.
4. **Recover:**
   - Rotate secrets.
   - Reissue cards.
   - Restore data from Time Travel if records were altered.
5. **Review:** record what happened and what changed.
