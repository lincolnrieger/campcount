# CampCount — Release 1 requirements (draft for approval)

Status: **Draft v0.1, 2026-10-23.** Items marked **[OPEN]** need an answer.
Items marked **[DEFAULT]** go ahead as written unless you object.

Target: first live event in **December 2026**. Feature freeze is
**30 November**, with a full dry run before the event.

## 1. Release 1 scope

In scope:

1. Staff accounts, roles and event-scoped permissions.
2. Event creation, a feature toggle per event, and the event lifecycle.
3. **Privacy-filtering import** of any registration spreadsheet (.xlsx or
   CSV), covering youth and adults, read on the device.
4. Dietary review step, so only dietary information is kept (see §4).
5. QR credentials and **printable lanyard cards** for every participant and
   leader.
6. Activity scanning (sign-in, optional sign-out), working offline.
7. Meal scanning, working offline.
8. Leader on-site / off-site scanning, working offline.
9. Shared **station devices** paired to one workflow.
10. Live counts per activity, meal and site status.
11. Close-out: a reconciliation list, then CSV exports.
12. Activity self-sign-up via a poster QR **[OPEN: needed for December?]**.

Deferred to Release 2:
- The annual activity report. The data it needs is kept from day one.
- Event templates.
- Excel (.xlsx) import directly.
- Humanitix import.
- Passkeys.
- Entra ID (Microsoft 365) sign-in.
- Parent portal.

## 2. Users and roles

| Role | Scope | Can |
|---|---|---|
| Platform Admin | Platform | Manage users (rename, make admin, disable, delete), create events, use View as, read the audit log. Every action is audited. |
| Event Manager | Event | Configure the event, import, manage the roster, assign staff, pair stations, correct records, export, close out. (Replaces the earlier Camp Director and Event Manager split.) |
| Scanner | Event | Scan people on and off site and in and out of every activity. Add people to come to any activity (book them), move them between activities, or remove a booking. Sees activity rosters (display fields only) and counts. (Replaces Activity Leader and Gate Volunteer.) |
| Activity Leader | Activity (one, or all if assigned to the event) | See the activity's roster and bookings, check people in and out with a tap or the scanner, add walk-ins, add or remove bookings. Nothing else in the event. |
| Meal Team | Event (meals) | Scan meals, see the dietary alert for the scanned person, see who has and hasn't eaten. No catering or dietary reports. |
| Station (device) | One workflow | Scan for that workflow only. Sees display fields only. It is not a person. |

Permissions are fixed in code; roles are data. A user can hold several
assignments. Every API route declares the permission it requires, and the
server checks it. A permission matrix test enumerates every route × role.

## 3. Data we keep from an imported spreadsheet

The import is an **allowlist**. The file is read **on the importing device**
and never uploaded. Columns are matched to fields by name on the device
(nothing sent); the manager checks each match or chooses "Don't send".
Nothing is sent until they press Import, and then only these fields. The
server rejects anything else.

| Field | Stored as | Purpose |
|---|---|---|
| First name (required; full or initial) | person.first_name, encrypted | Display, lanyard |
| Last name (optional; full, initial or none) | person.last_name, encrypted | Display, lanyard |
| Participant ID (optional; one is made if absent) | person.participant_id, encrypted, plus a keyed hash for lookups | Matching, typed lanyard code |
| Group (optional) | registration.group_name, encrypted | Display, reports |
| Level (optional) | registration.level, encrypted; youth or adult from the camp's level settings | Lanyard band, youth totals |
| Photo consent (optional) | registration.photo_consent: yes or no (anything unclear is no) | Photo indicator |
| Dietaries (optional) | **Not stored.** Read on the device during dietary review (§4). | Source of dietary entries |

**Never sent to the server**: every other column, including address, phone,
email, date of birth, Medicare number, medical conditions, medication,
swimming ability, doctor, guardian and emergency contacts. Nothing from the
file is kept on the importing device either.

## 4. Dietary requirements

The sample export has **no dietary column**. Dietary text
("Vegetarian") sits in `medical_conditions`, which may also contain real
medical information. Importing that column wholesale would break D-002.

Proposed flow:
1. During import, the browser lists only the rows where `medical_conditions`
   is non-empty.
2. The Director classifies each one into structured dietary entries:
   - **Category**: allergy, intolerance, medical diet, religious/cultural,
     preference.
   - **Item**: e.g. peanut, gluten, vegetarian.
   - **Severity**, for allergies: anaphylactic or not.
   - **Short note**: up to 80 characters, dietary only.
3. Only those structured entries go to the server. The original text is
   discarded.
4. On re-import, rows whose text has changed are flagged for review again.
   The browser compares a hash; the text is never stored.

The meal scanner shows a **coloured and labelled alert**, for example
"ALLERGY — peanut (anaphylactic)". Only Meal Team and meal stations see
it. The screen states that scanning does not confirm a meal is safe.

[OPEN] Should the meal-device offline cache include these dietary alerts?
Recommendation: yes, but only for meal devices, wiped at sign-out or event
close.

## 5. Credentials and lanyard cards

- Each event registration gets a random 128-bit token, encoded in the QR,
  plus an 8-character manual code (e.g. `K7QM-3XRP`).
- The server stores only a hash of the token.
- A reissue revokes the old card.
- Lanyard cards print from the browser onto A4 sheets with cut marks:
  - **[DEFAULT]** front: preferred first name and last initial, group,
    level colour band, QR code, manual code;
  - no participant ID or full surname on the card.
- **[OPEN]** Card size. Recommendation: 90 × 120 mm, which suits standard
  lanyard pouches. Alternatively credit-card size, 86 × 54 mm.

What the scanner shows after a scan (as you asked): first name and last
initial, participant ID, group. It also shows the "No photos" indicator
when consent is No or unknown.

## 6. Scanning rules

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

## 7. Offline behaviour

- Scan screens work with no connection after the device has loaded the
  context once.
- Scans queue on the device and sync automatically.
- A visible badge shows "N waiting to sync" and the time of the last
  successful sync.
- The server is authoritative. Conflicts, such as the same person scanned
  on two devices, are resolved by deterministic rules and listed for
  reconciliation.

## 8. Retention [DEFAULT — please confirm]

| Data | Kept until |
|---|---|
| Dietary entries, photo consent, car registrations, credentials | 90 days after event close |
| Registrations and attendance records | 2 years (for the annual report) |
| Person record (participant ID + names) | 2 years after last event |
| Aggregate statistics | Indefinitely |
| Audit log | 7 years (contains no sensitive values) |

## 9. Reports (Release 1)

- **Live**: count per activity (in now / total), count per meal versus the
  roster, on-site list.
- **Close-out**: reconciliation of people still signed in to activities or
  still on site, plus unsynced device warnings.
- **CSV exports**: activity attendance, meal counts, catering dietary
  summary (counts per item, no names), and a named dietary list for
  Event Managers only. Every export is audited.

## 10. Activity self-sign-up [OPEN]

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
