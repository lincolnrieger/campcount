# All data CampCount stores

Deletion times are counted from when the camp closes, and happen
automatically. **Encrypted** means CampCount encrypts it (AES-256-GCM) before
it reaches the database; only the app, holding a separate secret key, can
read it.

## About participants and leaders

| Data | Why it's kept | Stored | Deleted after |
|---|---|---|---|
| First name (or initial) | Rosters, lanyards, scanning | Encrypted | 2 years |
| Last name, initial, or nothing | Rosters, lanyards | Encrypted | 2 years |
| Participant ID (made up if the file has none) | Matching people across imports; typed code on the lanyard | Encrypted, plus a keyed hash for lookups | 2 years |
| Group | Rosters and reports | Encrypted | 2 years |
| Level, and whether that counts as youth or adult | Lanyard colour, youth totals | Level encrypted | 2 years |
| Status (active or withdrawn) | Running the camp | Plain | 2 years |
| Photo consent (Yes or No) | Marking lanyards so photographers know | Plain | **90 days** |
| Dietary needs and allergies (type, item, anaphylactic yes/no, short note) | Meals | Item and note encrypted | **90 days** |
| Leader's car registration (if they give one at the gate) | Contacting the owner about their car | Encrypted | **90 days** |
| Lanyard QR code and typed code | Scanning | Encrypted | Code disabled at 90 days, deleted at 2 years |
| Scans: who, where, when, in or out, which phone or staff member | Attendance and whereabouts | Personal | 2 years |
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

Camp name, dates, location and contact email, activities, meals and menus,
scanning devices, lanyard designs and images, and import counts (numbers
only, never the file).

## Audit log

What was done, by whom and when: imports, exports, changes, sign-ins and
deletions. It holds IDs and counts only, never names, dietary details or
contact details. It can't be changed and is kept for 7 years.

## Never stored

- Home addresses, phone numbers or emails of participants
- Dates of birth, Medicare numbers, guardian or emergency contacts
- Medical conditions, medication or swimming ability
- Free-text medical notes
- Preferred names, positions or any other spreadsheet column
- The imported spreadsheet (it's read on the importing device and never uploaded)
- Device locations
- IP addresses (Cloudflare's own request logs see them, but CampCount doesn't store them)

## On the importing device only (optional)

If the camp manager leaves "Keep the other columns on this device" on during
an import, the columns that weren't sent stay in that browser (IndexedDB),
shown on each person's page on that device only. They're never uploaded and
are wiped when that person signs out, or with "Remove from this device".
