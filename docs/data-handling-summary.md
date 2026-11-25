# CampCount: how participant data is handled

A short summary for reviewers. The detail is in
[`data-stored.md`](data-stored.md) (every item stored),
[`database.md`](database.md) (one-page overview),
[`architecture.md`](architecture.md) (threat model),
[`known-limitations.md`](known-limitations.md) and
[`../AUDIT.md`](../AUDIT.md) (the latest security audit).

CampCount is a general tool for camps and events. It isn't tied to any one
organisation or membership system.

## Name, participant ID and role only

CampCount is a check-in and check-out tool. It keeps three things about each
person, and nothing else:

- **Name:** first name (required) and last name (optional). Either can be
  just an initial.
- **Participant ID**, such as a membership number. If someone doesn't have
  one, CampCount makes one up. It's also the typed code on their lanyard.
- **Role:** participant or leader.

People are added one at a time (Add person). CampCount doesn't import
spreadsheets, doesn't connect to any other system, and doesn't pull data
from one. The server rejects any other field, so nothing outside that list
can be stored, even by mistake.

**Never stored:** groups, levels, photo consent, dietary needs or allergies,
medical conditions, medication, car registrations, addresses, phone numbers,
emails, dates of birth, Medicare numbers, and guardian and emergency
contacts.

Alongside that, CampCount records what happens at camp: scans in and out
(who, where, when), activity bookings, teams and duty rosters.

## Encryption and where the data is

- **Names, participant IDs and typed lanyard codes are encrypted before
  they're stored.** It uses AES-256-GCM with a key (`DATA_KEY`) held as a
  Cloudflare secret, separate from the database. Someone who got a copy of
  the database or a backup would see only scrambled values.
- People are found by participant ID using a keyed hash, so IDs are never
  stored in readable form.
- Hosted on Cloudflare (Workers and the D1 database), with the database set
  to the Oceania region. Cloudflare treats this as a location preference
  rather than a guarantee that data stays in Australia.
- All traffic uses HTTPS only, and Cloudflare also encrypts the database at
  rest.
- There are no third-party analytics, trackers or external scripts.
- Scanner phones keep a short offline list (names and roles, plus
  participant IDs for staff who can see the roster), protected by the
  phone's own encryption and wiped on sign-out.

## Access and retention

- Staff sign in with their own account. Each person sees only the camps and
  the parts of a camp their role allows.
- Exports, role changes and corrections are recorded in an append-only audit
  log, which holds no names.
- Lanyard codes stop working 90 days after a camp. Names, IDs and attendance
  are deleted after 2 years, and only totals are kept after that.
- The site tells search engines not to list it.

## Still to do

- Privacy impact assessment, and sign-off by the privacy officer.
- Rehearse a database restore before the first camp.
- Two open audit items (S-9 and S-11/S-12 in `AUDIT.md`) need a decision.
