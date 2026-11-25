# All data CampCount stores

Deletion times are counted from when the camp closes, and happen
automatically. **Encrypted** means CampCount encrypts it (AES-256-GCM) before
it reaches the database; only the app, holding a separate secret key, can
read it.

## About participants and leaders

Only three things are kept about a person: their name, their participant ID
and their role.

| Data | Why it's kept | Stored | Deleted after |
|---|---|---|---|
| First name (or initial) | Rosters, lanyards, scanning | Encrypted | 2 years |
| Last name, initial, or nothing | Rosters, lanyards | Encrypted | 2 years |
| Participant ID (made up if they have none) | Telling people apart; typed code on the lanyard | Encrypted, plus a keyed hash for lookups | 2 years |
| Role: participant or leader | Lanyard word and colour, totals | Plain | 2 years |
| Status (active or withdrawn) | Running the camp | Plain | 2 years |
| Lanyard QR code and typed code | Scanning | Encrypted | Code disabled at 90 days, deleted at 2 years |
| Scans: who, where, when, in or out, which phone or staff member | Check-in and check-out | Personal | 2 years |
| Activity bookings, team members, duty rosters | Running the camp | Personal | 2 years |
| Side Quest: who scanned whom (optional game) | The game | Personal | **90 days** |

After 2 years, only anonymous totals are kept (for example "312 attended").

## About staff

| Data | Why it's kept | Sensitive? | Deleted after |
|---|---|---|---|
| Name and email | Signing in | Personal | When the account is removed (unconfirmed sign-ups: 7 days) |
| Password (scrambled, can't be read back) | Signing in | Security | When the account is removed |
| Role on each camp | Controlling what each person can see | Ops | Kept as history |
| Sign-in codes and sessions (scrambled) | Signing in | Security | Within a day of expiring |

## About the camp (no personal information)

Camp name, dates, location and contact email, activities, meals and menus
(with each food item's allergens), scanning devices, and lanyard designs and
images.

## Audit log

What was done, by whom and when: exports, changes, sign-ins and deletions.
It holds IDs and counts only, never names or contact details. It can't be
changed and is kept for 7 years.

## Never stored

- Group, level or section
- Dietary needs, allergies, medical conditions or medication
- Photo consent
- Car registrations
- Home addresses, phone numbers or emails of participants
- Dates of birth, Medicare numbers, guardian or emergency contacts
- Spreadsheets or exports from other systems (there's no import: people are
  added one at a time)
- Device locations
- IP addresses (Cloudflare's own request logs see them, but CampCount doesn't store them)
