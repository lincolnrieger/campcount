# CampCount — Release 1 requirements (draft for approval)

Status: **Draft v0.1, 2026-10-23.** Items marked **[OPEN]** need an answer.
Items marked **[DEFAULT]** go ahead as written unless you object.

Target: first live event in **December 2026**. Feature freeze is
**30 November**, with a full dry run before the event.

## 1. Release 1 scope

In scope:

1. Staff accounts, roles and event-scoped permissions.
2. Event creation, a feature toggle per event, and the event lifecycle.
3. People added one at a time (**Add person**), youth and adults, keeping
   only name, participant ID and role (see §3).
4. QR credentials and **printable lanyard cards** for every participant and
   leader.
5. Activity scanning (sign-in, optional sign-out), working offline.
6. Meal scanning, working offline.
7. Leader on-site / off-site scanning, working offline.
8. Shared **station devices** paired to one workflow.
9. Live counts per activity, meal and site status.
10. Close-out: a reconciliation list, then CSV exports.
11. Activity self-sign-up via a poster QR **[OPEN: needed for December?]**.

Deferred to Release 2:
- The annual activity report. The data it needs is kept from day one.
- Event templates.
- Humanitix import.
- Passkeys.
- Entra ID (Microsoft 365) sign-in.
- Parent portal.

## 2. Users and roles

| Role | Scope | Can |
|---|---|---|
| Platform Admin | Platform | Manage users (rename, make admin, disable, delete), create events, use View as, read the audit log. Every action is audited. |
| Event Manager | Event | Configure the event, manage the roster, assign staff, pair stations, correct records, export, close out. (Replaces the earlier Camp Director and Event Manager split.) |
| Scanner | Event | Scan people on and off site and in and out of every activity. Add people to come to any activity (book them), move them between activities, or remove a booking. Sees names and roles on activity rosters, and counts. (Replaces Activity Leader and Gate Volunteer.) |
| Activity Leader | Activity (one, or all if assigned to the event) | See the activity's roster and bookings, check people in and out with a tap or the scanner, add walk-ins, add or remove bookings. Nothing else in the event. |
| Meal Team | Event (meals) | Scans people at meals and sees who has eaten. Nothing else in the event. |
| Station (device) | One workflow | Scan for that workflow only. Sees display fields only. It is not a person. |

Permissions are fixed in code; roles are data. A user can hold several
assignments. Every API route declares the permission it requires, and the
server checks it. A permission matrix test enumerates every route × role.

## 3. Data we keep about a person

People are added one at a time with **Add person**. Only these fields are
kept, and the server rejects anything else.

| Field | Stored as | Purpose |
|---|---|---|
| First name (required; full or initial) | person.first_name, encrypted | Display, lanyard |
| Last name (optional; full, initial or none) | person.last_name, encrypted | Display, lanyard |
| Participant ID (optional; a GUEST-xxxxxx ID is made if blank) | person.participant_id, encrypted, plus a keyed hash for lookups | Matching, typed lanyard code |
| Role: participant (youth) or leader (adult) | registration.kind: youth or adult | Lanyard role word and colour, youth totals |

Names and IDs are encrypted with AES-256-GCM under the `DATA_KEY` secret.
Nothing else about a person is kept: no address, phone, email, date of
birth, medical or dietary information, group, level or photo consent.

## 4. Credentials and lanyard cards

- Each event registration gets a random 128-bit token, encoded in the QR,
  plus an 8-character manual code (e.g. `K7QM-3XRP`).
- The server stores only a hash of the token.
- A reissue revokes the old card.
- Lanyard cards print from the browser onto A4 sheets with cut marks:
  - **[DEFAULT]** front: first name and last initial, the role word
    (Participant / Leader) in the role's colour, QR code, manual code;
  - no participant ID or full surname on the card.
- **[OPEN]** Card size. Recommendation: 90 × 120 mm, which suits standard
  lanyard pouches. Alternatively credit-card size, 86 × 54 mm.

What the scanner shows after a scan: name, participant ID and role.

## 5. Scanning rules

- Each scan is recorded against exactly one **context**: an activity, a
  meal, or the site.
- **Activity**: sign-in, plus optional sign-out per activity.
  - If the person is already signed in, the scan is reported as a
    duplicate.
  - When the activity is at capacity: **[DEFAULT]** warn, with an override.
  - Repeat attendance: configurable per activity, **[DEFAULT]** allowed.
- **Meal**: one counted attendance per person per meal.
  - Any repeat scan shows "Already served"; **[DEFAULT]** seconds are not
    tracked.
  - Eligibility: **[DEFAULT]** everyone on the roster.
- **Site**: scans toggle between on site and off site. The direction is
  shown and can be changed before saving.
  - **[DEFAULT]** A scanner or station scans the leader's lanyard.
    There is no self-scan.
- Corrections are new records that supersede old ones. Records are never
  edited or deleted. Each correction records who made it and why.

## 6. Offline behaviour

- Scan screens work with no connection after the device has loaded the
  context once.
- Scans queue on the device and sync automatically.
- A visible badge shows "N waiting to sync" and the time of the last
  successful sync.
- The server is authoritative. Conflicts, such as the same person scanned
  on two devices, are resolved by deterministic rules and listed for
  reconciliation.

## 7. Retention [DEFAULT — please confirm]

| Data | Kept until |
|---|---|
| Credentials | 90 days after event close |
| Registrations and attendance records | 2 years (for the annual report) |
| Person record (participant ID + names) | 2 years after last event |
| Aggregate statistics | Indefinitely |
| Audit log | 7 years (contains no sensitive values) |

## 8. Reports (Release 1)

- **Live**: count per activity (in now / total), count per meal versus the
  roster, on-site list.
- **Close-out**: reconciliation of people still signed in to activities or
  still on site, plus unsynced device warnings.
- **CSV exports**: all scans, activity summary, meal counts, and arrivals
  and departures. Every export is audited.

## 9. Activity self-sign-up [OPEN]

Proposed instead of email or phone verification:
1. The participant scans the activity's poster QR.
2. They enter the manual code from **their own lanyard**, or scan it.
3. They are added to that activity's booking list.

This needs no new personal data and no SMS or email costs, and holding the
lanyard is already the trust level used everywhere else. It is protected by
rate limiting and Cloudflare Turnstile, and it only works while the
Director has the sign-up window open.

Email or phone verification is only needed if people **not on the roster**
must sign up.
