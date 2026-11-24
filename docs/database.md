# CampCount database: a simple overview

![How data moves through CampCount](campcount-data-flow.png)

For every item stored and when it's deleted, see [All data CampCount stores](data-stored.md).

## Where it is

- One database, hosted by Cloudflare and set to the Oceania region.
  (Cloudflare treats this as a preference, not a promise that it stays in
  Australia.)
- Only the CampCount app can reach it. There's no public address or password
  for the database.
- **Every piece of participant data is encrypted by CampCount before it's
  stored** (names, participant IDs, groups, levels, dietary details). The key
  is a Cloudflare secret kept apart from the database, so the database on its
  own holds only scrambled values.
- It's also encrypted by Cloudflare when stored, and when sent over the internet.
- It can be restored to any point in the last 30 days.

## What it stores

| Group | What's kept |
|---|---|
| **People** | First name, last name (either can be just an initial), participant ID, group, level, photo consent (Yes or No). All encrypted except photo consent. |
| **Dietary** | Dietary needs and allergies, encrypted. Only staff who need them can see them. |
| **Camp activity** | Lanyard scans (who, where, when), activity and team bookings, duties |
| **Camp setup** | Activities, meals and menus, scanning devices, lanyard designs |
| **Staff** | Name, email and role for each camp |
| **Audit log** | Who did what: imports, exports, changes, sign-ins |

## What it never stores

- Home addresses, phone numbers or emails of participants
- Dates of birth, Medicare numbers or guardian details
- Medical conditions, medication or swimming ability
- Free-text medical notes
- The imported spreadsheet (it's read on the camp manager's device)
- Names, IDs, passwords or lanyard codes in readable form

## Keeping it safe

- Each camp's data is kept separate. Staff only see the camps they're
  assigned to, and only what their role allows.
- Scan records and the audit log can't be changed after they're written.

## When it's deleted (automatically)

| After the camp closes | Deleted |
|---|---|
| **90 days** | Dietary details, photo consent, car registrations |
| **2 years** | Names and attendance. Only anonymous totals are kept. |

## Still to fix

- A database restore hasn't been practised yet.
